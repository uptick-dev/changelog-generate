// Rewrites a git-cliff fragment's commit bullets into a few plain-language
// lines for a non-technical team, keeping the "### Section" / "- item" layout
// changelog-merge reads. Any failure leaves the fragment as git-cliff wrote it.

const fs = require("fs");

// cliff.toml prefixes breaking commits with this; changelog-merge lists those
// items under "Breaking changes", so they are kept word for word.
const BREAKING_MARKER = "[**breaking**]";

// Work with no visible change goes here instead of the fragment's own sections.
const BEHIND_THE_SCENES = "🔧 Behind the scenes";

const SYSTEM_PROMPT = `You write release notes for everyone at the company: sales, support, account management and leadership, not only engineers.

You get one pull request: its title, its description, and the changelog bullets generated from its commit messages, grouped by section.

Write the fewest bullets that tell a non-technical reader what changed for them or for customers:
- Usually one bullet. Use two or three only when the pull request makes clearly separate changes people would care about.
- Each bullet is one short sentence, at most about 20 words. Readers skim a list of many of these, so give the headline, not the details. The description is context for understanding the change, not material to copy.
- Plain words. No file names, function names, scopes in parentheses, ticket numbers or jargon. If a technical term is unavoidable, say what it means.
- Say what people can now do or what now works, not how the code changed.
- Merge commits that describe steps toward the same change into one bullet.
- Never name software, libraries, databases, frameworks or services (for example Redis, ClickHouse, React, Babel, Docker, Sentry, Dependabot). Describe what they do instead: "the reporting database", "the error tracker", "server software".
- Do not invent details that are not in the input.

Sections:
- Put changes people can see or use in the section that fits best, using only the section names given.
- Put work with no visible change (refactors, performance, infrastructure, upgrades, security patches, data cleanup) in "${BEHIND_THE_SCENES}", saying in plain words why it matters: faster, fewer errors, more reliable data, safer, lower costs, or groundwork for a named upcoming feature. The section name already says it is behind the scenes, so do not repeat that in the bullet.
- Leave out work that only affects engineers' own tools (developer machines, local development, CI, test suites, dependency bots), and behind-the-scenes work in a pull request that also has visible changes. "In development" and "locally" mean engineers' own machines: such a fix is never a visible change, even when it mentions a page or report.
- Always return at least one entry. If everything would be left out, write one short "${BEHIND_THE_SCENES}" bullet for the pull request's main purpose.`;

// Splits a fragment into the lines before the first "### " heading and its sections.
function parseFragment(content) {
  const preamble = [];
  const sections = new Map();
  let current = null;

  for (const line of content.split("\n")) {
    if (line.startsWith("### ")) {
      current = line.slice(4).trim();
      if (!sections.has(current)) sections.set(current, []);
    } else if (current && line.startsWith("- ")) {
      sections.get(current).push(line.slice(2));
    } else if (!current) {
      preamble.push(line);
    }
  }

  while (preamble.length && preamble[preamble.length - 1].trim() === "") {
    preamble.pop();
  }
  return { preamble, sections };
}

function buildPrompt({ title, body, sections }) {
  let commits = "";
  for (const [heading, items] of sections) {
    const rewritable = items.filter((item) => !item.includes(BREAKING_MARKER));
    if (rewritable.length === 0) continue;
    commits += `### ${heading}\n${rewritable.map((i) => `- ${i}`).join("\n")}\n\n`;
  }
  if (!commits) return null;

  return [
    `Pull request title: ${title || "(none)"}`,
    `Pull request description:\n${body?.trim() || "(none)"}`,
    `Changelog bullets from the commits:\n\n${commits.trim()}`,
  ].join("\n\n");
}

function outputSchema(headings) {
  return {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section: { type: "string", enum: headings },
            text: { type: "string" },
          },
          required: ["section", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };
}

// git-cliff sections that are never a visible change; their work goes behind the scenes.
const TECHNICAL_SECTION = /refactor|testing|miscellaneous|build/i;

// Sections the model may write into: the fragment's visible ones, then behind the scenes.
function sectionNames(sections) {
  const visible = [...sections.keys()].filter((heading) => !TECHNICAL_SECTION.test(heading));
  return [...new Set([...visible, BEHIND_THE_SCENES])];
}

// Rebuilds the fragment: breaking items first, then the rewritten entries, in
// section order with behind the scenes last. Sections left empty are dropped,
// but every section is visited so breaking items in technical ones survive.
function buildFragment({ preamble, sections }, entries) {
  let output = preamble.join("\n") + "\n";
  for (const heading of new Set([...sections.keys(), BEHIND_THE_SCENES])) {
    const items = sections.get(heading) || [];
    const kept = items.filter((item) => item.includes(BREAKING_MARKER));
    const written = entries
      .filter((entry) => entry.section === heading)
      .map((entry) =>
        entry.text
          .replace(/\s+/g, " ")
          .replace(/^[-*]\s*/, "")
          .replace(/^behind the scenes:\s*/i, "")
          .trim()
      )
      .filter(Boolean);
    const lines = [...kept, ...written];
    if (lines.length === 0) continue;
    output += `\n### ${heading}\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
  }
  return output;
}

async function summarize({ client, model, fragment, title, body }) {
  const parsed = parseFragment(fragment);
  const prompt = buildPrompt({ title, body, sections: parsed.sections });
  if (!prompt) return { fragment, reason: "no bullets to rewrite" };

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: outputSchema(sectionNames(parsed.sections)) },
    },
  });

  if (response.stop_reason !== "end_turn") {
    throw new Error(`model stopped with ${response.stop_reason}`);
  }
  const text = response.content.find((block) => block.type === "text")?.text;
  const { entries } = JSON.parse(text);
  // An empty answer would leave the PR out of the release notes entirely.
  if (!entries.some((entry) => entry.text.trim())) {
    throw new Error("model returned no entries");
  }
  return { fragment: buildFragment(parsed, entries) };
}

// CLI: rewrites $FRAGMENT in place. Warns and exits 0 on any failure, so a
// missing key or an API outage never blocks a pull request.
async function main() {
  const path = process.env.FRAGMENT;
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await summarize({
      client,
      model: process.env.MODEL,
      fragment: fs.readFileSync(path, "utf-8"),
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY,
    });
    if (result.reason) {
      console.log(`Left the fragment as is: ${result.reason}`);
      return;
    }
    fs.writeFileSync(path, result.fragment);
    console.log(result.fragment);
  } catch (error) {
    console.log(`::warning::Kept the git-cliff fragment; summarizing failed: ${error.message}`);
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { BREAKING_MARKER, BEHIND_THE_SCENES, parseFragment, buildPrompt, buildFragment, summarize };
}

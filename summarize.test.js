const { test } = require("node:test");
const assert = require("node:assert");
const {
  BEHIND_THE_SCENES,
  parseFragment,
  buildPrompt,
  buildFragment,
  summarize,
} = require("./summarize");

const FRAGMENT = `# Changelog

## [Unreleased]

### 🚀 Added
- *(ui)* show tracking method beside the advertiser name
- *(api)* [**breaking**] remove the v1 sites endpoint

### 🧪 Testing
- *(ui)* cover the advertiser header
`;

// Stands in for the SDK client, returning the given entries as the model's JSON.
function fakeClient(entries, stop_reason = "end_turn") {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { stop_reason, content: [{ type: "text", text: JSON.stringify({ entries }) }] };
      },
    },
  };
}

test("parseFragment splits the preamble from the sections", () => {
  const { preamble, sections } = parseFragment(FRAGMENT);
  assert.deepStrictEqual(preamble, ["# Changelog", "", "## [Unreleased]"]);
  assert.deepStrictEqual([...sections.keys()], ["🚀 Added", "🧪 Testing"]);
  assert.strictEqual(sections.get("🧪 Testing").length, 1);
});

test("buildPrompt leaves breaking items out and returns null when nothing is left", () => {
  const prompt = buildPrompt({ title: "feat: X", body: "", sections: parseFragment(FRAGMENT).sections });
  assert.ok(prompt.includes("show tracking method"));
  assert.ok(!prompt.includes("v1 sites endpoint"));

  const onlyBreaking = parseFragment("## [Unreleased]\n### Added\n- [**breaking**] drop X\n");
  assert.strictEqual(buildPrompt({ title: "", body: "", sections: onlyBreaking.sections }), null);
});

test("buildFragment keeps breaking items, places entries and drops empty sections", () => {
  const fragment = buildFragment(parseFragment(FRAGMENT), [
    { section: "🚀 Added", text: "- Advertiser pages now show\n how events are tracked" },
  ]);
  assert.strictEqual(
    fragment,
    `# Changelog

## [Unreleased]

### 🚀 Added
- *(api)* [**breaking**] remove the v1 sites endpoint
- Advertiser pages now show how events are tracked
`
  );
});

test("summarize rewrites through the model with a section enum", async () => {
  const client = fakeClient([{ section: "🚀 Added", text: "Advertiser pages show tracking" }]);
  const result = await summarize({ client, model: "m", fragment: FRAGMENT, title: "t", body: "b" });
  assert.ok(result.fragment.includes("- Advertiser pages show tracking"));
  assert.ok(!result.fragment.includes("Testing"));
  const schema = client.calls[0].output_config.format.schema;
  assert.deepStrictEqual(schema.properties.entries.items.properties.section.enum, [
    "🚀 Added",
    BEHIND_THE_SCENES,
  ]);
});

test("buildFragment puts behind-the-scenes entries last, without a repeated prefix", () => {
  const fragment = buildFragment(parseFragment("## [Unreleased]\n\n### 🚜 Refactor\n- move readers\n"), [
    { section: BEHIND_THE_SCENES, text: "Behind the scenes: reports read from one place" },
  ]);
  assert.strictEqual(fragment, `## [Unreleased]\n\n### ${BEHIND_THE_SCENES}\n- reports read from one place\n`);
});

test("buildFragment keeps breaking items in technical sections", () => {
  const fragment = buildFragment(parseFragment("## [Unreleased]\n\n### 🚜 Refactor\n- [**breaking**] drop v1\n"), [
    { section: BEHIND_THE_SCENES, text: "simpler data" },
  ]);
  assert.ok(fragment.includes("### 🚜 Refactor\n- [**breaking**] drop v1"));
});

test("summarize throws on an empty answer, so the PR is never left out", async () => {
  const client = fakeClient([
    { section: "🚀 Added", text: " " },
    { section: "🚀 Added", text: "-" },
    { section: BEHIND_THE_SCENES, text: "Behind the scenes:" },
  ]);
  await assert.rejects(summarize({ client, model: "m", fragment: FRAGMENT, title: "", body: "" }), /no entries/);
});

test("summarize throws when the model does not finish, so the caller keeps the original", async () => {
  const client = fakeClient([], "refusal");
  await assert.rejects(summarize({ client, model: "m", fragment: FRAGMENT, title: "", body: "" }), /refusal/);
});

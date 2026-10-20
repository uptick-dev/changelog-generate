// Bump level for a pull request, from its conventional commits and title.
// changelog-merge reads the resulting "<!-- bump: ... -->" fragment line.

const BUMPS = ["patch", "minor", "major"];

// Bump level of one conventional commit message (or PR title).
function bumpForMessage(message) {
  // git log separates entries with a newline, so a message can start with one.
  const lines = message.trim().split("\n");
  const header = lines[0];

  if (/^[a-z]+(\([^)]*\))?!:/i.test(header)) return "major";
  if (lines.some((line) => /^BREAKING[ -]CHANGE:/.test(line))) return "major";
  if (/^feat(\([^)]*\))?:/i.test(header)) return "minor";
  return "patch";
}

function maxBump(bumps) {
  return bumps.reduce(
    (max, bump) => (BUMPS.indexOf(bump) > BUMPS.indexOf(max) ? bump : max),
    "patch"
  );
}

// CLI: NUL-separated commit messages on stdin, prints patch|minor|major.
if (require.main === module) {
  const input = require("fs").readFileSync(0, "utf-8");
  const messages = input.split("\0").filter((m) => m.trim());
  console.log(maxBump(messages.map(bumpForMessage)));
} else {
  module.exports = { bumpForMessage, maxBump };
}

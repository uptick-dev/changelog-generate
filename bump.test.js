const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { bumpForMessage, maxBump } = require("./bump");

test("bumpForMessage reads conventional commits", () => {
  assert.strictEqual(bumpForMessage("fix: Thing"), "patch");
  assert.strictEqual(bumpForMessage("chore(deps): Bump"), "patch");
  assert.strictEqual(bumpForMessage("Update README"), "patch");
  assert.strictEqual(bumpForMessage("feat: Thing"), "minor");
  assert.strictEqual(bumpForMessage("feat(sdk): Thing"), "minor");
  assert.strictEqual(bumpForMessage("feat!: Thing"), "major");
  assert.strictEqual(bumpForMessage("fix(sdk)!: Thing"), "major");
  assert.strictEqual(
    bumpForMessage("fix: Thing\n\nBREAKING CHANGE: Removed X"),
    "major"
  );
  assert.strictEqual(
    bumpForMessage("fix: Thing\n\nBREAKING-CHANGE: Removed X"),
    "major"
  );
});

test("maxBump takes the highest", () => {
  assert.strictEqual(maxBump([]), "patch");
  assert.strictEqual(maxBump(["patch", "minor", "patch"]), "minor");
  assert.strictEqual(maxBump(["minor", "major"]), "major");
});

test("the CLI prints the bump for NUL-separated messages", () => {
  const run = (input) =>
    execFileSync("node", [path.join(__dirname, "bump.js")], { input })
      .toString()
      .trim();
  assert.strictEqual(run("fix: A\n\0chore: B\n\0"), "patch");
  assert.strictEqual(run("fix: A\n\0feat: B\n\0"), "minor");
  assert.strictEqual(run("fix: A\n\nBREAKING CHANGE: C\n\0feat: B\0"), "major");
  assert.strictEqual(run(""), "patch");
  // git log --format='%B%x00' puts a newline between entries.
  assert.strictEqual(run("fix: A\n\0\nfeat!: B\0"), "major");
});

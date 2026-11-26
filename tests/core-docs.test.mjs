import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModules } from "../skills/bootstrap/scripts/render.mjs";
import { brokenLinks, files, realModulesDir, renderReal } from "./helpers.mjs";

const dest = renderReal([]);
const read = path => readFileSync(join(dest, path), "utf8");

test("CLAUDE.md is a short index", () => {
  assert.ok(read("CLAUDE.md").split("\n").length <= 60);
});

test("the workflow table and the CLAUDE.md index list the same branch prefixes", () => {
  const table = [...read("docs/workflow.md").matchAll(/^\| `([a-z]+\/)` \|/gm)].map(m => m[1]);
  const index = [...read("CLAUDE.md").match(/^- Branches are named.*$/m)[0].matchAll(/`([a-z]+\/)`/g)].map(m => m[1]);
  assert.ok(table.includes("chore/"));
  assert.deepEqual(index, table);
});

test("each merge policy renders its own rule in the workflow and the CLAUDE.md index", () => {
  const rules = {
    claude: [/^- Claude merges a PR once it meets the definition of done and every required\s+check passes, including PRs that cut a release\. This is standing approval/m, /^- Merge a PR yourself .*release PRs included.*standing approval/m],
    "claude-except-release": [/^- Claude merges a PR once [^\n]*\n[^\n]*It asks the maintainer before merging a PR that cuts a release/m, /^- Merge a PR yourself .*ask the maintainer before merging one that cuts a release/m],
    maintainer: [/^- The maintainer merges every PR\. Claude marks a PR ready once it meets the\s+definition of done, and stops there\./m, /^- Never merge a PR: mark it ready and leave the merge to the maintainer/m],
  };
  for (const [merge_policy, [workflow, index]] of Object.entries(rules)) {
    const dir = renderReal([], { merge_policy });
    const text = path => readFileSync(join(dir, path), "utf8");
    assert.match(text("docs/workflow.md"), workflow, merge_policy);
    assert.match(text("CLAUDE.md"), index, merge_policy);
    assert.equal(/standing approval/.test(text("CLAUDE.md")), merge_policy !== "maintainer", merge_policy);
  }
});

test("every relative Markdown link resolves", () => {
  assert.deepEqual(brokenLinks(dest), []);
});

test("licence carries the standard title and handle notice", () => {
  const licence = read("LICENSE.md");
  assert.equal(licence.split("\n")[0], "# One Lone Raven Noncommercial Licence 1.0.0");
  assert.match(licence, /^Required Notice: Copyright One Lone Raven \(https:\/\/github\.com\/oneloneraven\)$/m);
  assert.match(licence, /https:\/\/github\.com\/sample-owner\/sample-project\/blob\/main\/LICENSE\.md/);
});

test("Claude settings block edits on main", () => {
  const settings = JSON.parse(read(".claude/settings.json"));
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Write|Edit");
});

test("no placeholder survives", () => {
  for (const file of files(dest)) assert.doesNotMatch(read(file), /(?<!\$)\{\{/, file);
});

test("coding standards carry the review framework", () => {
  assert.match(read("docs/coding-standards.md"), /## Part 1: Review framework/);
});

test("model routing names tiers, not model IDs", () => {
  const claude = read("CLAUDE.md");
  assert.match(claude, /Opus-class/);
  assert.match(claude, /Sonnet-class/);
  assert.doesNotMatch(claude, /claude-(opus|sonnet)-\d/);
});

test("the screening ADR points at the register and no longer holds the table", () => {
  const adr = read(".bootstrap/vault/adr/0002-screen-dependencies-against-bds-boycott-lists.md");
  assert.doesNotMatch(adr, /\| Dependency/);
  assert.match(adr, /## Screening record\n\n[^|]*\(https:\/\/github\.com\/[^)]+\/blob\/main\/docs\/dependency-register\.md\)/);
});

test("the CLAUDE.md index, definition of done and PR template point at the register", () => {
  assert.match(read("CLAUDE.md"), /^- Screen new dependencies and vendors and record each in \[the register\]\(docs\/dependency-register\.md\): ADR-0002 \(in the vault\)\.$/m);
  assert.match(read("docs/definition-of-done.md").replace(/\s+/g, " "), /row added to \[the dependency register\]\(dependency-register\.md\)/);
  assert.match(read(".github/pull_request_template.md"), /^- \[ \] Screened: .*rows? added to docs\/dependency-register\.md/m);
});

const COMBINATIONS = [
  [[], {}],
  [["js-toolchain"], {}],
  [["web-app"], {}],
  [["python-toolchain"], {}],
  [["android-toolchain"], { application_id: "org.example.sample" }],
  [["cloudflare-opentofu"], { zone_name: "example.test", beta: false }],
  [["cloudflare-identity"], {}],
];

for (const [selected, extra] of COMBINATIONS) {
  test(`the register for ${selected.join(", ") || "core"} has every selected module's rows and the latest check date`, () => {
    const dir = renderReal(selected, extra);
    const register = readFileSync(join(dir, "docs/dependency-register.md"), "utf8");
    const rows = resolveModules(selected, realModulesDir).flatMap(m => m.screening);
    assert.ok(rows.length > 0);
    assert.match(register, /^\| Dependency or vendor \| Used for \| Maintainer \| On a list\? \| Decision \|\n\|---\|---\|---\|---\|---\|$/m);
    for (const row of rows) {
      const line = `| ${row.dependency} | ${row.usedFor} | ${row.maintainer} | ${row.listed === "Y" ? "Yes" : "No"} | ${row.decision} |`;
      assert.ok(register.includes(line), row.dependency);
    }
    const latest = rows.map(row => row.screenedOn).sort().at(-1);
    assert.match(register, new RegExp(`Last checked against both lists on ${latest}\\.`));
    assert.equal([...register.matchAll(/^\| /gm)].length, rows.length + 1);
  });
}

test("every module's screening rows say what they are used for, the decision and when they were screened", () => {
  const manifests = ["js-toolchain", "web-app", "python-toolchain", "android-toolchain", "cloudflare-opentofu", "cloudflare-identity"].flatMap(name => resolveModules([name], realModulesDir));
  for (const manifest of manifests) {
    for (const row of manifest.screening) {
      for (const key of ["dependency", "usedFor", "maintainer", "decision"]) assert.ok(typeof row[key] === "string" && row[key].trim(), `${manifest.name} ${row.dependency} ${key}`);
      assert.match(row.screenedOn, /^\d{4}-\d{2}-\d{2}$/, `${manifest.name} ${row.dependency}`);
      assert.ok(["Y", "N"].includes(row.listed), `${manifest.name} ${row.dependency}`);
      assert.equal(row.note, undefined);
    }
  }
});

test("gitignore covers local state and secrets", () => {
  const ignore = read(".gitignore");
  for (const entry of [".bootstrap/", ".dev.vars", ".env*"]) assert.ok(ignore.includes(entry), entry);
});

test("gitignore keeps secrets and tool state out and config in", () => {
  const dir = mkdtempSync(join(tmpdir(), "ignore-"));
  copyFileSync(join(dest, ".gitignore"), join(dir, ".gitignore"));
  execFileSync("git", ["init", "-q", dir]);
  const ignored = path => spawnSync("git", ["-c", "core.excludesFile=/dev/null", "-C", dir, "check-ignore", "-q", "--no-index", path]).status === 0;
  for (const path of [
    ".claude/settings.local.json",
    ".claude/worktrees/x",
    ".wrangler/state",
    "infra/.terraform/providers",
    "infra/terraform.tfstate",
    "infra/terraform.tfstate.backup",
    "infra/terraform.tfvars",
    "test-results/x",
    ".venv/x",
    "src/app/__pycache__/x.pyc",
    ".pytest_cache/x",
    ".ruff_cache/x",
    ".gradle/x",
    ".kotlin/x",
    "app/build/x",
    "local.properties",
    "upload.jks",
    "release.keystore",
  ]) {
    assert.ok(ignored(path), `${path} should be ignored`);
  }
  for (const path of ["infra/terraform.tfvars.example", "infra/.terraform.lock.hcl", ".claude/settings.json", ".env.example", "gradle/wrapper/gradle-wrapper.jar", "app/src/test/screenshots/x.png"]) {
    assert.ok(!ignored(path), `${path} should stay tracked`);
  }
});

test("a core-only CLAUDE.md has no empty Stack section", () => {
  assert.doesNotMatch(read("CLAUDE.md"), /## Stack/);
});

test("the licence notice uses the licensor answer", () => {
  assert.match(read("LICENSE.md"), /^Required Notice: Copyright One Lone Raven \(https:\/\/github\.com\/oneloneraven\)$/m);
});

test("the workflow doc uses the board's status names", () => {
  const doc = read("docs/workflow.md");
  assert.match(doc, /\*\*In progress\*\*/);
  assert.match(doc, /\*\*In review\*\*/);
  assert.doesNotMatch(doc, /In Progress|In Review/);
});

test("the workflow doc explains the board views and title prefixes", () => {
  const doc = read("docs/workflow.md");
  for (const term of ["[EPIC]", "[BUG]", "[CHORE]", "Priority", "Size", "Estimate", "No parent epic"]) {
    assert.ok(doc.includes(term), `${term} should be explained`);
  }
});

test("the destructive-change rule is in the CLAUDE.md index and the workflow", () => {
  assert.match(read("CLAUDE.md"), /^- Ask before any destructive change outside the repository, even mid-task: \[workflow\]\(docs\/workflow\.md#ways-of-working\)\.$/m);
  assert.match(read("docs/workflow.md"), /^- Ask before any destructive change outside the repository, such as deleting,\s+disabling or overwriting something in a hosted service, even mid-task and even\s+when it looks like part of the work\.$/m);
});

test("renders without cloudflare-opentofu have no infrastructure rule", () => {
  for (const [name, dir] of [["core", dest], ["web-app", renderReal(["web-app"])]]) {
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(claude, /infra\/README\.md/, name);
    assert.doesNotMatch(claude, /through an API, an MCP tool or the dashboard/, name);
  }
});

test("both copies of working-with-claude.md route subagents through the main checkout and make delegation optional", () => {
  const copies = {
    rendered: read("docs/working-with-claude.md"),
    repository: readFileSync(new URL("../docs/working-with-claude.md", import.meta.url), "utf8"),
  };
  for (const [name, text] of Object.entries(copies)) {
    const flat = text.replace(/\s+/g, " ");
    assert.doesNotMatch(flat, /own worktree whenever/, name);
    for (const phrase of ["Subagents work in the main checkout", "Delegation is a choice", "affected tests while working"]) {
      assert.ok(flat.includes(phrase), `${name}: ${phrase}`);
    }
  }
});

test("the PR template has a What's new section before the definition of done, and both lists carry Announced", () => {
  const template = read(".github/pull_request_template.md");
  assert.ok(template.indexOf("## What's new") > 0);
  assert.ok(template.indexOf("## What's new") < template.indexOf("## Definition of done"));
  assert.match(template, /<!-- One plain sentence per change a user would notice\. Leave empty if they won't notice anything\. -->/);
  assert.match(template, /^- \[ \] Announced: /m);
  assert.match(read("docs/definition-of-done.md"), /^9\. \*\*Announced\.\*\*/m);
});

test("release notes come from What's new, and the versioning doc says how to adopt them", () => {
  const versioning = read("docs/versioning.md").replace(/\s+/g, " ");
  assert.match(versioning, /Release notes are the lines under the PR's "What's new" heading/);
  assert.match(versioning, /Adopting What's new in an existing project/);
  assert.doesNotMatch(versioning, /generated notes/);
});

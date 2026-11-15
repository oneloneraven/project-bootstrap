import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bumpOf,
  nextVersion,
  parsePulls,
  planFromRepo,
  planReleases,
} from "../skills/bootstrap/modules/core/templates/github/scripts/plan-releases.mjs";
import { hasWhatsNewHeading, placeholdersIn, whatsNewFromPrBody } from "../skills/bootstrap/modules/core/templates/github/scripts/whats-new.mjs";
import { checkWhatsNew } from "../skills/bootstrap/modules/core/templates/github/scripts/check-whats-new.mjs";
import { checkReleasePaths } from "../skills/bootstrap/modules/core/templates/github/scripts/check-release-paths.mjs";

const PRS = {
  a: { number: 1, labels: ["release: patch"] },
  b: { number: 2, labels: ["release: minor", "enhancement"] },
  c: { number: 3, labels: ["release: none"] },
  d: { number: 4, labels: [] },
};
const plan = (commits, { tagged = [], latestVersion = "v2.9.5" } = {}) =>
  planReleases({ commits, latestVersion, isTagged: sha => tagged.includes(sha), prFor: sha => PRS[sha] ?? null });

test("planReleases tags every released PR since the latest tag, oldest first", () => {
  assert.deepEqual(plan(["a", "b"]), [
    { sha: "a", version: "v2.9.6", pr: 1, message: "v2.9.6", notes: "" },
    { sha: "b", version: "v2.10.0", pr: 2, message: "v2.10.0", notes: "" },
  ]);
});

test("planReleases skips none, unlabelled, PR-less and already-tagged commits", () => {
  assert.deepEqual(
    plan(["a", "c", "d", "x", "b"], { tagged: ["a"] }).map(r => [r.sha, r.version]),
    [["b", "v2.10.0"]],
  );
});

test("planReleases starts from v0.0.0 when there is no tag yet", () => {
  assert.deepEqual(plan(["b"], { latestVersion: null }), [{ sha: "b", version: "v0.1.0", pr: 2, message: "v0.1.0", notes: "" }]);
});

test("bumpOf takes the largest release label", () => {
  assert.equal(bumpOf(["release: patch", "release: major"]), "major");
  assert.equal(bumpOf(["release: none"]), null);
});

test("nextVersion bumps each part", () => {
  assert.equal(nextVersion("v2.9.5", "major"), "v3.0.0");
  assert.equal(nextVersion("v2.9.5", "minor"), "v2.10.0");
  assert.equal(nextVersion("v1.10.0", "patch"), "v1.10.1");
});

function fakeGit({ tags = "v2.9.5\nv2.9.4", ancestor = true, revList = "a\nb" } = {}) {
  const calls = [];
  const git = args => {
    calls.push(args.join(" "));
    if (args[0] === "tag" && args[1] === "-l") return tags;
    if (args[0] === "merge-base") {
      if (!ancestor) throw new Error("not an ancestor");
      return "";
    }
    if (args[0] === "rev-list") return revList;
    if (args[0] === "tag" && args[1] === "--points-at") return "";
    if (args[0] === "rev-parse") return "head";
    return "";
  };
  return { git, calls };
}

test("planFromRepo plans from the latest tag to the merge commit", () => {
  const { git, calls } = fakeGit();
  const result = planFromRepo({ git, prFor: sha => PRS[sha] ?? null, mergeSha: "b" });
  assert.deepEqual(result.map(r => r.version), ["v2.9.6", "v2.10.0"]);
  assert.ok(calls.includes("rev-list --reverse --first-parent v2.9.5..b"));
});

test("planFromRepo with no tags plans the merge commit only", () => {
  const { git, calls } = fakeGit({ tags: "", revList: "a\nb" });
  const asked = [];
  const result = planFromRepo({
    git,
    prFor: sha => {
      asked.push(sha);
      return PRS[sha] ?? null;
    },
    mergeSha: "b",
  });
  assert.deepEqual(result, [{ sha: "b", version: "v0.1.0", pr: 2, message: "v0.1.0", notes: "" }]);
  assert.deepEqual(asked, ["b"]);
  assert.ok(!calls.some(call => call.startsWith("rev-list")));
});

test("planFromRepo with no tags and no bump label plans nothing", () => {
  const { git } = fakeGit({ tags: "" });
  assert.deepEqual(planFromRepo({ git, prFor: sha => PRS[sha] ?? null, mergeSha: "c" }), []);
});

test("parsePulls returns the parsed list", () => {
  assert.deepEqual(parsePulls("[]", "abc"), []);
});

test("parsePulls throws naming the sha on empty or non-JSON output", () => {
  assert.throws(() => parsePulls("", "abc123"), /abc123.*""/);
  assert.throws(() => parsePulls("not json", "abc123"), /abc123.*not json/);
  assert.throws(() => parsePulls('{"message":"x"}', "abc123"), /abc123/);
});

test("parsePulls truncates long output", () => {
  assert.throws(() => parsePulls("x".repeat(2000), "abc123"), err => err.message.length < 700);
});

test("planFromRepo refuses when the latest tag isn't in the merge commit's history", () => {
  const { git } = fakeGit({ ancestor: false });
  assert.throws(() => planFromRepo({ git, prFor: () => null, mergeSha: "b" }), /isn't in b's history/);
});

test("planFromRepo honours a manual bump", () => {
  const { git } = fakeGit();
  assert.deepEqual(planFromRepo({ git, prFor: () => null, mergeSha: "", bumpInput: "minor" }), [
    { sha: "head", version: "v2.10.0", pr: null, message: "v2.10.0", notes: "" },
  ]);
});

const cfg = { noneAllowed: ["docs/", ".github/", "*.md"], noneForbidden: ["infra/"] };

test("checkReleasePaths allows docs and root Markdown", () => {
  assert.deepEqual(checkReleasePaths(["docs/x.md", "README.md"], cfg), { ok: true, offending: [] });
});

test("checkReleasePaths rejects nested Markdown outside an allowed folder", () => {
  assert.deepEqual(checkReleasePaths(["src/help/page.md"], cfg), { ok: false, offending: ["src/help/page.md"] });
});

test("checkReleasePaths rejects forbidden paths even under an allowed glob", () => {
  const result = checkReleasePaths(["docs/a.md", "infra/main.tf", "infra/README.md"], cfg);
  assert.deepEqual(result, { ok: false, offending: ["infra/main.tf", "infra/README.md"] });
});

test("checkReleasePaths matches exact file entries", () => {
  assert.equal(checkReleasePaths([".gitignore"], { noneAllowed: [".gitignore"], noneForbidden: [] }).ok, true);
});

test("planFromRepo refuses a manual bump when HEAD is already tagged", () => {
  const { git } = fakeGit();
  const tagged = args => (args[0] === "tag" && args[1] === "--points-at" ? "v2.9.5" : git(args));
  assert.throws(() => planFromRepo({ git: tagged, prFor: () => null, mergeSha: "", bumpInput: "patch" }), {
    message: "HEAD is already released as v2.9.5",
  });
});

const body = text => `Closes #1\n\n## What's new\n\n${text}\n\n## Definition of done\n\n- [ ] Tracked\n`;

test("the What's new heading matches either apostrophe and any case", () => {
  assert.equal(hasWhatsNewHeading("## What's new\n"), true);
  assert.equal(hasWhatsNewHeading("## What\u2019s new  \n"), true);
  assert.equal(hasWhatsNewHeading("## what's NEW"), true);
  assert.equal(hasWhatsNewHeading("### What's new"), false);
  assert.equal(hasWhatsNewHeading("What's new"), false);
  assert.equal(hasWhatsNewHeading(undefined), false);
});

test("the What's new lines lose their bullets and CRLF line endings", () => {
  assert.deepEqual(whatsNewFromPrBody(body("- Search is faster.\n* Backups now run daily.\nYou can sign in with a link.")), [
    "Search is faster.",
    "Backups now run daily.",
    "You can sign in with a link.",
  ]);
  assert.deepEqual(whatsNewFromPrBody(body("- One.\n- Two.").replace(/\n/g, "\r\n")), ["One.", "Two."]);
});

test("HTML comments in the What's new section are skipped, single line or several", () => {
  assert.deepEqual(whatsNewFromPrBody(body("<!-- One plain sentence per change. -->")), []);
  assert.deepEqual(whatsNewFromPrBody(body("<!-- a\nstill a comment\n-->\n- Real change.")), ["Real change."]);
});

test("the What's new section ends at the next heading, a rule or the attribution line", () => {
  assert.deepEqual(whatsNewFromPrBody("## What's new\n- A.\n## Definition of done\n- B.\n"), ["A."]);
  assert.deepEqual(whatsNewFromPrBody("# What's new\n"), []);
  assert.deepEqual(whatsNewFromPrBody("## What's new\n- A.\n---\n- B.\n"), ["A."]);
  assert.deepEqual(whatsNewFromPrBody("## What's new\n- A.\n\n\ud83e\udd16 Generated with [Claude Code](https://claude.com/claude-code)\n"), ["A."]);
  assert.deepEqual(whatsNewFromPrBody("## What's new\n- A.\n- B."), ["A.", "B."]);
  assert.deepEqual(whatsNewFromPrBody("no section here"), []);
  assert.deepEqual(whatsNewFromPrBody(undefined), []);
});

test("placeholders are found and real changes are not", () => {
  assert.deepEqual(placeholdersIn(["None", "n/a.", "Nothing user-facing", "-", "Search is faster."]), ["None", "n/a.", "Nothing user-facing", "-"]);
  assert.deepEqual(placeholdersIn(["Nothing works offline yet."]), []);
});

const pr = (labels, text) => ({ labels: labels.map(name => ({ name })), body: text });

test("a releasing PR needs the What's new heading, and release: none doesn't", () => {
  for (const label of ["major", "minor", "patch"]) {
    assert.equal(checkWhatsNew(pr([`release: ${label}`], "Closes #1")).ok, false, label);
    assert.equal(checkWhatsNew(pr([`release: ${label}`], body(""))).ok, true, label);
  }
  assert.equal(checkWhatsNew(pr(["release: none"], "Closes #1")).ok, true);
  assert.equal(checkWhatsNew(pr([], "Closes #1")).ok, true);
  assert.equal(checkWhatsNew({ labels: [{ name: "release: minor" }], body: null }).ok, false);
});

test("a releasing PR fails when its What's new holds only a placeholder", () => {
  const result = checkWhatsNew(pr(["release: patch"], body("- None")));
  assert.equal(result.ok, false);
  assert.match(result.message, /"None"/);
  assert.equal(checkWhatsNew(pr(["release: patch"], body("- Search is faster."))).ok, true);
  assert.equal(checkWhatsNew(pr(["release: none"], body("- None"))).ok, true);
});

test("planReleases carries each PR's What's new lines into its tag message and notes", () => {
  const prs = {
    a: { number: 1, labels: ["release: patch"], body: body("- Search is faster.\n- Backups now run daily.") },
    b: { number: 2, labels: ["release: minor"], body: body("<!-- nothing -->") },
    c: { number: 3, labels: ["release: none"], body: body("- Must never appear.") },
    d: { number: 4, labels: ["release: patch"] },
  };
  const result = planReleases({ commits: ["a", "b", "c", "d"], latestVersion: "v1.0.0", isTagged: () => false, prFor: sha => prs[sha] });
  assert.deepEqual(result, [
    { sha: "a", version: "v1.0.1", pr: 1, message: "v1.0.1\n\nSearch is faster.\nBackups now run daily.", notes: "- Search is faster.\n- Backups now run daily.\n" },
    { sha: "b", version: "v1.1.0", pr: 2, message: "v1.1.0", notes: "" },
    { sha: "d", version: "v1.1.1", pr: 4, message: "v1.1.1", notes: "" },
  ]);
  assert.ok(!JSON.stringify(result).includes("Must never appear"));
});

test("a manual release with no PR has empty notes", () => {
  const { git } = fakeGit();
  const [release] = planFromRepo({ git, prFor: () => null, mergeSha: "", bumpInput: "minor" });
  assert.equal(release.notes, "");
  assert.equal(release.message, release.version);
});

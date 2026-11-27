import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { markDone, markSkipped, saveAnswers } from "../skills/bootstrap/scripts/state.mjs";
import { publishRecordInGitignore } from "../skills/bootstrap/scripts/record.mjs";
import { checkReleasePaths } from "../skills/bootstrap/modules/core/templates/github/scripts/check-release-paths.mjs";
import { realModulesDir, renderReal } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "record-"));
const script = fileURLToPath(new URL("../skills/bootstrap/scripts/record.mjs", import.meta.url));
const record = dir => JSON.parse(readFileSync(join(dir, ".bootstrap", "record.json"), "utf8"));
const base = { owner_type: "User", name: "Demo", owner: "sample-owner", visibility: "public", merge_policy: "claude", licensor: "Private Person" };
const cloudflare = { ...base, zone_name: "example.test", zone_shared: false, beta: true, admin: false, turnstile: true, d1: false };

test("saving the answers writes a record with the resolved modules, visibility and no private answer", () => {
  const dir = tmp();
  saveAnswers(dir, base, ["js-toolchain"], realModulesDir);
  assert.deepEqual(record(dir), {
    version: 1,
    modules: ["core", "js-toolchain"],
    visibility: "public",
    flags: { owner_org: false },
    skipped: {},
    exceptions: [],
  });
  assert.doesNotMatch(readFileSync(join(dir, ".bootstrap", "record.json"), "utf8"), /Private Person|sample-owner|Demo/);
});

test("flags hold only the boolean answers a manifest's when names", () => {
  const dir = tmp();
  saveAnswers(dir, cloudflare, ["cloudflare-opentofu"], realModulesDir);
  assert.deepEqual(record(dir).flags, { admin: false, beta: true, d1: false, owner_org: false, turnstile: true, zone_shared: false });
});

test("a skip adds its reason and a later done clears it", () => {
  const dir = tmp();
  saveAnswers(dir, base, [], realModulesDir);
  markSkipped(dir, "github:core:4", "ruleset not available on this plan");
  assert.deepEqual(record(dir).skipped, { "github:core:4": "ruleset not available on this plan" });
  markDone(dir, "github:core:4");
  assert.deepEqual(record(dir).skipped, {});
});

for (const [label, reason, field] of [
  ["an email address", "asked someone@example.com", /email address/],
  ["a URL with credentials", "see https://user:pass@example.com/x", /URL with credentials/],
  ["a private answer", "waiting on Private Person", /private answer/],
]) {
  test(`a skip reason holding ${label} is refused, and neither the state nor the record changes`, () => {
    const dir = tmp();
    saveAnswers(dir, base, [], realModulesDir);
    const before = [readFileSync(join(dir, ".bootstrap", "state.json"), "utf8"), readFileSync(join(dir, ".bootstrap", "record.json"), "utf8")];
    assert.throws(() => markSkipped(dir, "github:core:5", reason), { message: new RegExp(`skipped\\["github:core:5"\\] holds an? ${field.source}`) });
    assert.deepEqual([readFileSync(join(dir, ".bootstrap", "state.json"), "utf8"), readFileSync(join(dir, ".bootstrap", "record.json"), "utf8")], before);
  });
}

test("a public answer such as the zone may appear in a reason", () => {
  const dir = tmp();
  saveAnswers(dir, cloudflare, ["cloudflare-opentofu"], realModulesDir);
  markSkipped(dir, "github:cloudflare-opentofu:1", "example.test has no www record");
  assert.equal(record(dir).skipped["github:cloudflare-opentofu:1"], "example.test has no www record");
});

test("rewrites keep the maintainer's exceptions, and a bad one is refused", () => {
  const dir = tmp();
  saveAnswers(dir, base, [], realModulesDir);
  const exceptions = [{ check: "required-checks", match: "e2e-safari", reason: "No Safari runner" }];
  writeFileSync(join(dir, ".bootstrap", "record.json"), JSON.stringify({ ...record(dir), exceptions }));
  markSkipped(dir, "github:core:5", "board added later");
  assert.deepEqual(record(dir).exceptions, exceptions);
  writeFileSync(join(dir, ".bootstrap", "record.json"), JSON.stringify({ ...record(dir), exceptions: [{ check: "labels", reason: " " }] }));
  assert.throws(() => markDone(dir, "github:core:5"), { message: "exceptions[0].reason is required" });
  writeFileSync(join(dir, ".bootstrap", "record.json"), JSON.stringify({ ...record(dir), exceptions: [{ check: "labels", reason: "owner is a@b.io" }] }));
  assert.throws(() => markDone(dir, "github:core:5"), { message: /exceptions\[0\]\.reason holds an email address/ });
});

test("record.mjs write builds the record from state.json and publishes it in .gitignore", () => {
  const dir = tmp();
  saveAnswers(dir, base, [], realModulesDir);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n.bootstrap/\ndist/\n");
  const out = execFileSync("node", [script, "write", dir], { encoding: "utf8" });
  assert.match(out, /from state\.json/);
  assert.match(out, /replaced \.bootstrap\/ with/);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules/\n.bootstrap/*\ndist/\n!.bootstrap/record.json\n");
  assert.deepEqual(record(dir).modules, ["core"]);
});

test("record.mjs write without a state.json needs --modules and --visibility", () => {
  const dir = tmp();
  const refused = spawnSync("node", [script, "write", dir], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /pass --modules and --visibility/);
  assert.ok(!existsSync(join(dir, ".bootstrap", "record.json")));
  execFileSync("node", [script, "write", dir, "--modules", "web-app", "--visibility", "private"], { encoding: "utf8" });
  assert.deepEqual(record(dir), { version: 1, modules: ["core", "js-toolchain", "web-app"], visibility: "private", flags: {}, skipped: {}, exceptions: [] });
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), ".bootstrap/*\n!.bootstrap/record.json\n");
});

test("the .gitignore change is idempotent and appends when nothing ignored .bootstrap", () => {
  const dir = tmp();
  writeFileSync(join(dir, ".gitignore"), "dist/");
  assert.match(publishRecordInGitignore(dir), /^added/);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "dist/\n.bootstrap/*\n!.bootstrap/record.json\n");
  assert.equal(publishRecordInGitignore(dir), "unchanged");
});

test("the record's negation goes after every other rule, so a later pattern can't ignore it again", () => {
  const dir = tmp();
  writeFileSync(join(dir, ".gitignore"), ".bootstrap/\n\n*.json\n");
  publishRecordInGitignore(dir);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), ".bootstrap/*\n\n*.json\n!.bootstrap/record.json\n");
  mkdirSync(join(dir, ".bootstrap"));
  writeFileSync(join(dir, ".bootstrap", "record.json"), "{}");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  assert.equal(spawnSync("git", ["check-ignore", ".bootstrap/record.json"], { cwd: dir }).status, 1);
});

test("a short private answer doesn't refuse every reason, and a refusal says where to reword it", () => {
  const dir = tmp();
  saveAnswers(dir, { ...base, licensor: "AB" }, [], realModulesDir);
  markSkipped(dir, "github:core:4", "ABOUT to upgrade the plan");
  assert.throws(() => markSkipped(dir, "github:core:5", "ask x@example.com"), { message: /reword it in \.bootstrap\/state\.json$/ });
});

test("record.mjs write refuses --modules and --visibility when a state.json exists", () => {
  const dir = tmp();
  saveAnswers(dir, base, [], realModulesDir);
  const refused = spawnSync("node", [script, "write", dir, "--visibility", "private"], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /drop --modules and --visibility/);
  assert.equal(record(dir).visibility, "public");
});

test("a new project's .gitignore commits the record and nothing else from .bootstrap", () => {
  const dir = renderReal([]);
  mkdirSync(join(dir, ".bootstrap", "vault"), { recursive: true });
  for (const path of ["record.json", "state.json", "answers.json", "vault/threat-model.md"]) writeFileSync(join(dir, ".bootstrap", path), "{}");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const ignored = spawnSync("git", ["check-ignore", ".bootstrap/record.json", ".bootstrap/state.json", ".bootstrap/answers.json", ".bootstrap/vault/threat-model.md"], { cwd: dir, encoding: "utf8" });
  assert.deepEqual(ignored.stdout.trim().split("\n"), [".bootstrap/state.json", ".bootstrap/answers.json", ".bootstrap/vault/threat-model.md"]);
});

test("a PR that only changes the record can be labelled release: none", () => {
  const { releasePaths } = JSON.parse(readFileSync(join(realModulesDir, "core", "manifest.json"), "utf8"));
  assert.equal(checkReleasePaths([".bootstrap/record.json"], releasePaths).ok, true);
  assert.equal(checkReleasePaths([".bootstrap/state.json"], releasePaths).ok, false);
});

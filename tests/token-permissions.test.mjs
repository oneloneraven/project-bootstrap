import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeDropped, droppedPermissions } from "../skills/bootstrap/scripts/token-permissions.mjs";
import { renderReal } from "./helpers.mjs";

const token = (name, permissions) => ({ token: name, secret: `${name.toUpperCase()}_TOKEN`, permissions });

test("nothing is dropped when every token and permission is still there", () => {
  const existing = [token("Preview", ["A", "B"]), token("Deploy", ["C"])];
  assert.deepEqual(droppedPermissions(existing, existing), []);
});

test("added tokens and permissions are not drops", () => {
  assert.deepEqual(droppedPermissions([token("Preview", ["A"])], [token("Preview", ["A", "B"]), token("New", ["C"])]), []);
});

test("every dropped permission is named under its token, in the existing order", () => {
  const existing = [token("Preview", ["A", "B", "C"]), token("Deploy", ["D"]), token("Plan", ["E", "F"])];
  const rendered = [token("Preview", ["B"]), token("Deploy", ["D"]), token("Plan", ["F"])];
  assert.deepEqual(droppedPermissions(existing, rendered), [
    { token: "Preview", permissions: ["A", "C"] },
    { token: "Plan", permissions: ["E"] },
  ]);
});

test("a dropped token is reported whole, and tokens match by name not position", () => {
  const existing = [token("Preview", ["A"]), token("Deploy", ["B"])];
  assert.deepEqual(droppedPermissions(existing, [token("Deploy", ["B"])]), [{ token: "Preview", permissions: null }]);
});

test("the description names each token and permission", () => {
  assert.equal(describeDropped([{ token: "Preview", permissions: ["D1 Write", "A"] }, { token: "Plan", permissions: null }]), "Preview: D1 Write, A\nPlan: the whole token");
});

const script = fileURLToPath(new URL("../skills/bootstrap/scripts/render.mjs", import.meta.url));
const tokensPath = project => join(project, ".bootstrap", "cloudflare", "tokens.json");

function setup(existing, answers) {
  const project = mkdtempSync(join(tmpdir(), "guard-"));
  const answersFile = join(project, "answers.json");
  writeFileSync(answersFile, JSON.stringify({ ...JSON.parse(readFileSync(new URL("./fixtures/answers-core.json", import.meta.url), "utf8")), zone_name: "example.test", beta: false, ...answers }));
  if (existing) {
    mkdirSync(join(project, ".bootstrap", "cloudflare"), { recursive: true });
    writeFileSync(tokensPath(project), existing);
  }
  const run = (...flags) => spawnSync("node", [script, "--modules", "cloudflare-opentofu", "--answers", answersFile, "--dest", project, "--bootstrap-only", ...flags], { encoding: "utf8" });
  return { project, run };
}

const withD1 = readFileSync(join(renderReal(["cloudflare-opentofu"], { zone_name: "example.test", beta: false, d1: true }), ".bootstrap/cloudflare/tokens.json"), "utf8");

test("--bootstrap-only refuses to drop permissions, names each, and leaves the file alone", () => {
  const { project, run } = setup(withD1, { d1: false });
  const result = run();
  assert.notEqual(result.status, 0);
  for (const expected of ["Preview: D1 Write", "Deploy: D1 Write", "Infra plan: D1 Read", "Infra apply: D1 Write"]) assert.match(result.stderr, new RegExp(expected));
  assert.match(result.stderr, /--allow-dropped-permissions/);
  assert.equal(readFileSync(tokensPath(project), "utf8"), withD1);
});

test("--bootstrap-only refuses to drop a whole token", () => {
  const trimmed = JSON.stringify(JSON.parse(withD1).concat({ token: "Extra", secret: "EXTRA", permissions: ["X"] }));
  const { project, run } = setup(trimmed, { d1: true });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Extra: the whole token/);
  assert.equal(readFileSync(tokensPath(project), "utf8"), trimmed);
});

test("--bootstrap-only writes when nothing is dropped or the file is new", () => {
  const same = setup(withD1, { d1: true });
  assert.equal(same.run().status, 0);
  assert.equal(readFileSync(tokensPath(same.project), "utf8"), withD1);
  const fresh = setup(null, { d1: false });
  const result = fresh.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readFileSync(tokensPath(fresh.project), "utf8").includes("Preview"));
});

test("--allow-dropped-permissions writes anyway and warns about what was dropped", () => {
  const { project, run } = setup(withD1, { d1: false });
  const result = run("--allow-dropped-permissions");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Warning: .*would lose/);
  assert.match(result.stderr, /Infra plan: D1 Read/);
  assert.doesNotMatch(readFileSync(tokensPath(project), "utf8"), /D1/);
});

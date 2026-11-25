import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateRequiredChecks, MODULES_DIR, readRules } from "../skills/bootstrap/scripts/conformance-rules.mjs";

const KINDS = new Set([
  "record-present",
  "ruleset-matches-record",
  "required-checks",
  "settings-match-record",
  "labels-match-record",
  "files-present",
  "dependabot",
  "workflow-healthy",
  "engage-protection-rule",
  "secrets-absent",
]);
const rules = readRules();
const modules = new Set(
  readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name),
);
const coreFiles = new Set(
  JSON.parse(readFileSync(join(MODULES_DIR, "core", "manifest.json"), "utf8")).files.map(file => file.to),
);

test("the rules file is version 1", () => {
  assert.equal(rules.version, 1);
});

test("every check has a unique id, a title, a known kind and real modules", () => {
  const ids = rules.checks.map(check => check.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const check of rules.checks) {
    assert.match(check.id, /^[a-z0-9-]+$/, check.id);
    assert.ok(check.title, check.id);
    assert.ok(KINDS.has(check.kind), `${check.id}: unknown kind ${check.kind}`);
    for (const module of check.modules) assert.ok(modules.has(module), `${check.id}: no module ${module}`);
  }
});

test("requiredChecks matches every module manifest", () => {
  assert.deepEqual(rules.requiredChecks, generateRequiredChecks());
});

test("every path a check expects is one core writes", () => {
  for (const check of rules.checks.filter(check => check.paths))
    for (const path of check.paths) assert.ok(coreFiles.has(path), `${check.id}: core doesn't write ${path}`);
  const workflow = rules.checks.find(check => check.kind === "workflow-healthy");
  assert.ok(coreFiles.has(`.github/workflows/${workflow.workflow}`));
});

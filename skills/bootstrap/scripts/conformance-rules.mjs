#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RULES_PATH = fileURLToPath(new URL("../../../conformance/rules.json", import.meta.url));
export const MODULES_DIR = fileURLToPath(new URL("../modules", import.meta.url));

/**
 * Each module's `requiredChecks`, read from its manifest, keyed by module name in name order.
 * @param {string} modulesDir
 */
export function generateRequiredChecks(modulesDir = MODULES_DIR) {
  const names = readdirSync(modulesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  return Object.fromEntries(
    names.map(name => {
      const manifest = JSON.parse(readFileSync(join(modulesDir, name, "manifest.json"), "utf8"));
      return [name, manifest.requiredChecks ?? []];
    }),
  );
}

/** @param {string} path */
export const readRules = (path = RULES_PATH) => JSON.parse(readFileSync(path, "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rules = readRules();
  const generated = generateRequiredChecks();
  const drifted = JSON.stringify(rules.requiredChecks) !== JSON.stringify(generated);
  if (process.argv.includes("--write")) {
    writeFileSync(RULES_PATH, `${JSON.stringify({ ...rules, requiredChecks: generated }, null, 2)}\n`);
  } else if (process.argv.includes("--check") && drifted) {
    console.error("conformance/rules.json is out of date: run node skills/bootstrap/scripts/conformance-rules.mjs --write");
    process.exit(1);
  }
}

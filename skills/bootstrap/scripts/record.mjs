#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveModules } from "./modules.mjs";

export const RECORD_VERSION = 1;
export const MODULES_DIR = fileURLToPath(new URL("../modules", import.meta.url));
const recordFile = dir => join(dir, ".bootstrap", "record.json");

const PUBLIC_QUESTION_TYPES = new Set(["boolean", "hostname", "dns_label", "application_id"]);
const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i;
const CREDENTIAL_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/i;

function conditionNames(value) {
  if (Array.isArray(value)) return value.flatMap(conditionNames);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "when" ? [item].flat().map(condition => String(condition).replace(/^!/, "")) : conditionNames(item),
  );
}

function privateValues(answers, manifests) {
  const keys = ["licensor", ...manifests.flatMap(m => m.questions ?? []).filter(q => !PUBLIC_QUESTION_TYPES.has(q.type)).map(q => q.key)];
  return keys.map(key => answers[key]).filter(value => typeof value === "string" && value.trim().length >= 4);
}

function checkPublishable(field, text, secrets, fix) {
  const refuse = what => new Error(`${field} holds ${what}, and the record is public: ${fix}`);
  if (CREDENTIAL_URL.test(text)) throw refuse("a URL with credentials");
  if (EMAIL.test(text)) throw refuse("an email address");
  if (secrets.some(secret => text.includes(secret))) throw refuse("a private answer");
}

function checkExceptions(exceptions) {
  if (!Array.isArray(exceptions)) throw new Error("exceptions must be a list");
  return exceptions.map((exception, i) => {
    const { check, match, reason } = exception ?? {};
    if (typeof check !== "string" || !check.trim()) throw new Error(`exceptions[${i}].check is required`);
    if (match !== undefined && (typeof match !== "string" || !match.trim())) throw new Error(`exceptions[${i}].match must be a non-empty string`);
    if (typeof reason !== "string" || !reason.trim()) throw new Error(`exceptions[${i}].reason is required`);
    return { check, ...(match !== undefined && { match }), reason };
  });
}

export function buildRecord(state, { modulesDir = MODULES_DIR, exceptions = [] } = {}) {
  const { answers } = state;
  if (!["public", "private"].includes(String(answers?.visibility))) throw new Error("The record needs the visibility");
  const manifests = resolveModules(state.modules, modulesDir);
  const named = new Set([...manifests.flatMap(conditionNames), "owner_org"]);
  named.delete("private");
  const flags = Object.fromEntries([...named].sort().filter(key => typeof answers[key] === "boolean").map(key => [key, answers[key]]));
  const skipped = Object.fromEntries(Object.entries(state.skipped ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const checked = checkExceptions(exceptions);
  const secrets = privateValues(answers, manifests);
  for (const [step, reason] of Object.entries(skipped)) checkPublishable(`skipped["${step}"]`, reason, secrets, "reword it in .bootstrap/state.json");
  checked.forEach(({ reason }, i) => checkPublishable(`exceptions[${i}].reason`, reason, secrets, "reword it in .bootstrap/record.json"));
  return { version: RECORD_VERSION, modules: manifests.map(m => m.name), visibility: answers.visibility, flags, skipped, exceptions: checked };
}

export function readRecord(dir) {
  if (!existsSync(recordFile(dir))) return null;
  try {
    return JSON.parse(readFileSync(recordFile(dir), "utf8"));
  } catch {
    throw new Error("Corrupt .bootstrap/record.json");
  }
}

export function writeRecord(dir, state, modulesDir = MODULES_DIR) {
  if (!state.answers?.visibility) return null;
  const record = buildRecord(state, { modulesDir, exceptions: readRecord(dir)?.exceptions ?? [] });
  const path = recordFile(dir);
  mkdirSync(join(dir, ".bootstrap"), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return record;
}

export const IGNORE_RULES = [".bootstrap/*", "!.bootstrap/record.json"];

const [IGNORE_FOLDER, PUBLISH_RECORD] = IGNORE_RULES;

export function publishRecordInGitignore(dir) {
  const path = join(dir, ".gitignore");
  const text = existsSync(path) ? readFileSync(path, "utf8").replace(/\n+$/, "") : "";
  const lines = text ? text.split("\n") : [];
  if (lines.includes(IGNORE_FOLDER) && lines.lastIndexOf(PUBLISH_RECORD) > lines.indexOf(IGNORE_FOLDER)) return "unchanged";
  const old = lines.findIndex(line => [".bootstrap/", ".bootstrap", "/.bootstrap/", "/.bootstrap"].includes(line.trim()));
  const kept = lines.filter(line => line !== PUBLISH_RECORD);
  if (old >= 0) kept.splice(kept.indexOf(lines[old]), 1, IGNORE_FOLDER);
  else if (!kept.includes(IGNORE_FOLDER)) kept.push(IGNORE_FOLDER);
  kept.push(PUBLISH_RECORD);
  writeFileSync(path, `${kept.join("\n")}\n`);
  return old >= 0 ? `replaced ${lines[old].trim()} with ${IGNORE_RULES.join(" and ")}` : `added ${IGNORE_RULES.join(" and ")}`;
}

function loadStateFile(dir) {
  const path = join(dir, ".bootstrap", "state.json");
  if (!existsSync(path)) return null;
  return { skipped: {}, ...JSON.parse(readFileSync(path, "utf8")) };
}

const USAGE = "Usage: record.mjs write <dir> [--modules <a,b>] [--visibility public|private]";

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { modules: { type: "string" }, visibility: { type: "string" } },
  });
  const [command, dir] = positionals;
  if (command !== "write" || !dir) throw new Error(USAGE);
  const state = loadStateFile(dir);
  if (state?.answers?.visibility && (values.modules || values.visibility)) {
    throw new Error(`${dir} has a .bootstrap/state.json, which the record is built from: drop --modules and --visibility`);
  }
  const from = state?.answers?.visibility
    ? state
    : { answers: { visibility: values.visibility }, modules: (values.modules ?? "").split(",").filter(Boolean), skipped: {} };
  if (!state?.answers?.visibility && (!values.modules || !values.visibility)) {
    throw new Error(`${dir} has no .bootstrap/state.json with answers: pass --modules and --visibility\n${USAGE}`);
  }
  writeRecord(dir, from);
  console.log(`wrote .bootstrap/record.json${state?.answers ? " from state.json" : ""}`);
  console.log(`.gitignore: ${publishRecordInGitignore(dir)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

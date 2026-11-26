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
  return keys.map(key => answers[key]).filter(value => typeof value === "string" && value.trim());
}

function checkPublishable(field, text, secrets) {
  if (CREDENTIAL_URL.test(text)) throw new Error(`${field} holds a URL with credentials, and the record is public`);
  if (EMAIL.test(text)) throw new Error(`${field} holds an email address, and the record is public`);
  if (secrets.some(secret => text.includes(secret))) throw new Error(`${field} holds a private answer, and the record is public`);
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

/**
 * The public record of a bootstrapped project, from its state. Throws when a reason would publish a private detail.
 * @param {{ answers: Record<string, unknown>, modules: string[], skipped?: Record<string, string> }} state
 */
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
  for (const [step, reason] of Object.entries(skipped)) checkPublishable(`skipped["${step}"]`, reason, secrets);
  checked.forEach(({ reason }, i) => checkPublishable(`exceptions[${i}].reason`, reason, secrets));
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

/** Rebuilds the record from `state`, keeping the exceptions the maintainer wrote. A state without answers has no record yet. */
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

/** Switches a project's `.gitignore` from ignoring `.bootstrap/` to publishing its record. Returns what changed. */
export function publishRecordInGitignore(dir) {
  const path = join(dir, ".gitignore");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  if (IGNORE_RULES.every(rule => lines.includes(rule))) return "unchanged";
  const old = lines.findIndex(line => [".bootstrap/", ".bootstrap", "/.bootstrap/", "/.bootstrap"].includes(line.trim()));
  const kept = lines.filter(line => !IGNORE_RULES.includes(line));
  if (old >= 0) {
    const at = kept.findIndex(line => line === lines[old]);
    kept.splice(at, 1, ...IGNORE_RULES);
  } else {
    if (kept.length && kept.at(-1) === "") kept.pop();
    kept.push(...IGNORE_RULES, "");
  }
  writeFileSync(path, kept.join("\n").replace(/\n*$/, "\n"));
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

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { validateAnswers } from "./answers.mjs";
import { maxSlugLength, mergePolicies, resolveModules } from "./modules.mjs";
import { loadState, saveRun } from "./state.mjs";
import { describeDropped, droppedPermissions } from "./token-permissions.mjs";

export { maxSlugLength, resolveModules, validateAnswers };

const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|woff2?|zip|pem|jar)$/i;
const PLACEHOLDER = /(?<!\$)\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export const VAULT_STAGING = join(".bootstrap", "vault");

const SCREENING_FIELDS = ["dependency", "usedFor", "maintainer", "listed", "decision", "screenedOn"];

function screeningRows(modules) {
  return modules.flatMap(module =>
    (module.screening ?? []).map(row => {
      for (const field of SCREENING_FIELDS) {
        if (typeof row[field] !== "string" || !row[field].trim()) {
          throw new Error(`${module.name}'s screening row "${row.dependency ?? "?"}" needs ${field}`);
        }
      }
      if (!["Y", "N"].includes(row.listed)) throw new Error(`${module.name}'s screening row "${row.dependency}" needs listed to be Y or N`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.screenedOn)) throw new Error(`${module.name}'s screening row "${row.dependency}" needs screenedOn as YYYY-MM-DD`);
      return row;
    }),
  );
}

function screeningTable(rows) {
  return [
    "| Dependency or vendor | Used for | Maintainer | On a list? | Decision |",
    "|---|---|---|---|---|",
    ...rows.map(r => `| ${r.dependency} | ${r.usedFor} | ${r.maintainer} | ${r.listed === "Y" ? "Yes" : "No"} | ${r.decision} |`),
  ].join("\n");
}

function standardsFragments(modules, modulesDir) {
  return modules
    .map(m => join(modulesDir, m.name, "templates", "standards-fragment.md"))
    .filter(existsSync)
    .map(path => readFileSync(path, "utf8").trimEnd())
    .join("\n\n");
}

function allowBuildsYaml(modules) {
  return Object.entries(Object.assign({}, ...modules.map(m => m.allowBuilds ?? {})))
    .map(([name, { allow, reason }]) => `  # ${reason.replace(/\s+/g, " ").trim()}\n  ${JSON.stringify(name)}: ${allow}`)
    .join("\n");
}

const JSON_LINE_WIDTH = 120;

export function formatJson(value, indent = "") {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const flat = `[${value.map(item => JSON.stringify(item)).join(", ")}]`;
    if (value.every(item => typeof item !== "object" || item === null) && indent.length + flat.length < JSON_LINE_WIDTH) return flat;
    return `[\n${value.map(item => inner + formatJson(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatJson(item, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function deepMerge(base, extra) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const isObject = value && typeof value === "object" && !Array.isArray(value);
    const mergeable = merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key]);
    merged[key] = isObject && mergeable ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

function mergePolicyKeys(modules, policy) {
  const policies = mergePolicies(modules);
  if (!Object.hasOwn(policies, policy ?? "")) return {};
  return { merge_rule: policies[policy].rule.join("\n"), merge_index: policies[policy].index };
}

function deriveKeys(modules, answers, modulesDir) {
  const screening = screeningRows(modules);
  const checks = [
    ...new Set(
      modules
        .flatMap(m => m.requiredChecks ?? [])
        .map(check => (typeof check === "string" ? { context: check } : check))
        .filter(check => included(check, answers))
        .map(check => check.context),
    ),
  ];
  return {
    required_checks_json: JSON.stringify(checks.map(context => ({ context }))),
    claude_index: modules.flatMap(m => m.claudeIndexLines ?? []).join("\n"),
    claude_stack_section: modules.some(m => m.claudeIndexLines?.length)
      ? `\n## Stack\n\n${modules.flatMap(m => m.claudeIndexLines ?? []).join("\n")}\n`
      : "",
    coding_standards_modules: standardsFragments(modules, modulesDir),
    screening_table: screeningTable(screening),
    screening_checked: screening.map(row => row.screenedOn).sort().at(-1) ?? "",
    allow_builds_yaml: allowBuildsYaml(modules),
    release_paths_json: formatJson({
      noneAllowed: [...new Set(modules.flatMap(m => m.releasePaths?.noneAllowed ?? []))],
      noneForbidden: [...new Set(modules.flatMap(m => m.releasePaths?.noneForbidden ?? []))],
    }),
    ...mergePolicyKeys(modules, answers.merge_policy),
    ...(answers.zone_name && {
      app_host: answers.zone_shared ? `${answers.app_subdomain}.${answers.zone_name}` : answers.zone_name,
      beta_label: answers.zone_shared ? `${answers.app_subdomain}-beta` : "beta",
    }),
    ...(answers.owner && { repo_url: `https://github.com/${answers.owner}/${answers.slug}`, vault_repo: `${answers.owner}-vault` }),
  };
}

function holds(condition, answers) {
  const negated = condition.startsWith("!");
  const value = Boolean(answers[negated ? condition.slice(1) : condition]);
  return negated ? !value : value;
}

function included(file, answers) {
  if (!file.when) return true;
  return Array.isArray(file.when) ? file.when.some(condition => holds(condition, answers)) : holds(file.when, answers);
}

function substitute(text, values, to) {
  return text.replace(PLACEHOLDER, (match, key) => {
    if (values[key] === undefined) {
      if (key.startsWith("fragment_")) throw new Error(`Unknown fragment "${key.slice("fragment_".length)}" in ${to}`);
      throw new Error(`Unresolved placeholder {{${key}}} in ${to}`);
    }
    return String(values[key]);
  });
}

function withFragments(modules, modulesDir, base) {
  const declared = new Map();
  for (const module of modules) {
    for (const [name, declaration] of Object.entries(module.fragments ?? {})) {
      if (declared.has(name)) throw new Error(`Fragment "${name}" is declared by both ${declared.get(name).module} and ${module.name}`);
      const { path, when } = typeof declaration === "string" ? { path: declaration } : declaration;
      declared.set(name, { module: module.name, path: join(modulesDir, module.name, path), when });
    }
  }
  const values = { ...base };
  const resolving = [];
  for (const [name, { path, when }] of declared) {
    let text;
    Object.defineProperty(values, `fragment_${name}`, {
      enumerable: true,
      get: () => {
        if (text !== undefined) return text;
        if (resolving.includes(name)) throw new Error(`Fragment cycle: ${[...resolving.slice(resolving.indexOf(name)), name].join(" -> ")}`);
        resolving.push(name);
        try {
          text = included({ when }, base) ? substitute(readFileSync(path, "utf8"), values, `fragment ${name}`) : "";
        } finally {
          resolving.pop();
        }
        return text;
      },
    });
  }
  return values;
}

export function render({ modules, answers, modulesDir, destDir, dryRun = false, stage, bootstrapOnly = false }) {
  const base = { ...answers, ...deriveKeys(modules, answers, modulesDir) };
  const values = withFragments(modules, modulesDir, base);
  const root = resolve(destDir);
  const outputs = new Map();
  const owners = new Map();
  const mergers = new Map();
  const executables = new Set();
  for (const module of modules) {
    for (const file of module.files ?? []) {
      if (!included(file, answers)) continue;
      if (stage && (file.stage ?? "initial") !== stage) continue;
      if (bootstrapOnly && file.vault) continue;
      const to = substitute(file.to, values, file.to);
      const base = file.vault ? resolve(root, VAULT_STAGING) : root;
      const target = resolve(base, normalize(to));
      const within = relative(base, target);
      if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error(`Path escapes destination: ${to}`);
      }
      const rel = relative(root, target);
      if (bootstrapOnly && !rel.startsWith(`.bootstrap${sep}`)) continue;
      const source = join(modulesDir, module.name, file.from);
      const content = BINARY.test(source)
        ? readFileSync(source)
        : substitute(readFileSync(source, "utf8"), values, to);
      const owner = owners.get(rel);
      if (file.merge) {
        if (!owner) throw new Error(`${module.name} merges into ${rel}, but no earlier module writes it`);
        outputs.set(rel, `${formatJson(deepMerge(JSON.parse(outputs.get(rel)), JSON.parse(content)))}\n`);
        mergers.set(rel, module.name);
        continue;
      }
      if (mergers.has(rel)) {
        throw new Error(`${module.name} overrides ${rel}, which ${mergers.get(rel)} merges into; merge instead`);
      }
      if (owner && !(module.overrides ?? []).includes(rel)) {
        throw new Error(`${rel} is written by both ${owner} and ${module.name}; declare it in ${module.name}'s overrides`);
      }
      owners.set(rel, module.name);
      outputs.set(rel, content);
      if (statSync(source).mode & 0o111) executables.add(rel);
      else executables.delete(rel);
    }
  }
  for (const rel of outputs.keys()) {
    if ([...outputs.keys()].some(other => other.startsWith(`${rel}${sep}`))) {
      throw new Error(`${rel} is both a file and a directory`);
    }
  }
  if (!dryRun) {
    for (const [rel, content] of outputs) {
      const target = join(root, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (executables.has(rel)) chmodSync(target, 0o755);
    }
  }
  return [...outputs.keys()];
}

const TOKENS_FILE = join(".bootstrap", "cloudflare", "tokens.json");

function guardTokenPermissions({ modules, answers, modulesDir, destDir, allow }) {
  const existingPath = join(destDir, TOKENS_FILE);
  if (!existsSync(existingPath)) return;
  const staging = mkdtempSync(join(tmpdir(), "bootstrap-tokens-"));
  try {
    render({ modules, answers, modulesDir, destDir: staging, bootstrapOnly: true });
    const renderedPath = join(staging, TOKENS_FILE);
    if (!existsSync(renderedPath)) return;
    const dropped = droppedPermissions(JSON.parse(readFileSync(existingPath, "utf8")), JSON.parse(readFileSync(renderedPath, "utf8")));
    if (!dropped.length) return;
    const report = `${TOKENS_FILE} would lose:\n${describeDropped(dropped)}`;
    if (!allow) throw new Error(`${report}\nRefusing to write it. Add the missing answers, or pass --allow-dropped-permissions to write it anyway.`);
    console.error(`Warning: ${report}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      modules: { type: "string", default: "" },
      answers: { type: "string" },
      dest: { type: "string" },
      "modules-dir": { type: "string", default: fileURLToPath(new URL("../modules", import.meta.url)) },
      "dry-run": { type: "boolean", default: false },
      stage: { type: "string" },
      "bootstrap-only": { type: "boolean", default: false },
      "allow-dropped-permissions": { type: "boolean", default: false },
    },
  });
  const selected = values.modules.split(",").filter(Boolean);
  const modules = resolveModules(selected, values["modules-dir"]);
  const { answers } = validateAnswers(JSON.parse(readFileSync(values.answers, "utf8")));
  if (values["bootstrap-only"] && !values["dry-run"]) guardTokenPermissions({ modules, answers, modulesDir: values["modules-dir"], destDir: values.dest, allow: values["allow-dropped-permissions"] });
  const written = render({
    modules,
    answers,
    modulesDir: values["modules-dir"],
    destDir: values.dest,
    dryRun: values["dry-run"],
    stage: values.stage,
    bootstrapOnly: values["bootstrap-only"],
  });
  if (values["bootstrap-only"] && !values["dry-run"]) {
    const recorded = loadState(values.dest).modules;
    saveRun(values.dest, { answers, modules: [...new Set([...recorded, ...selected])] }, undefined, values["modules-dir"]);
  }
  console.log(written.sort().join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

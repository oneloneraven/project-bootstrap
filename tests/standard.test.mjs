import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatStandard, generateStandard, STANDARD_PATH } from "../skills/bootstrap/scripts/standard.mjs";
import { realModulesDir } from "./helpers.mjs";

const script = fileURLToPath(new URL("../skills/bootstrap/scripts/standard.mjs", import.meta.url));
const scriptsDir = fileURLToPath(new URL("../skills/bootstrap/scripts", import.meta.url));
const standard = generateStandard();
const names = readdirSync(realModulesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
const manifests = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(join(realModulesDir, name, "manifest.json"), "utf8"))]));
const moduleDoc = name => readFileSync(join(realModulesDir, name, "MODULE.md"), "utf8");

test("the committed standard is the generated one", () => {
  assert.equal(readFileSync(STANDARD_PATH, "utf8"), formatStandard(standard));
});

test("the release stamp is the only difference, and the output is reproducible", () => {
  const first = execFileSync("node", [script, "--release", "v9.8.7"], { encoding: "utf8" });
  assert.equal(execFileSync("node", [script, "--release", "v9.8.7"], { encoding: "utf8" }), first);
  const { bootstrap, ...rest } = JSON.parse(first);
  assert.equal(bootstrap, "v9.8.7");
  assert.equal(formatStandard(rest), formatStandard(standard));
  assert.equal(spawnSync("node", [script, "--release", "main"]).status, 2);
});

test("every check has a unique id, a group and a kind, and security checks run on every repository", () => {
  const ids = standard.checks.map(check => check.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const check of standard.checks) {
    assert.ok(["conformance", "security"].includes(check.group), check.id);
    assert.match(check.kind, /^[a-z0-9-]+$/, check.id);
    for (const module of check.modules) assert.ok(names.includes(module), `${check.id}: no module ${module}`);
    if (check.group === "security") assert.deepEqual(check.modules, [], check.id);
  }
  assert.ok(!standard.checks.some(check => /-record$/.test(check.kind)));
});

test("core-docs no longer needs the threat model, and vault-docs needs the vault's copy", () => {
  const coreDocs = standard.checks.find(check => check.id === "core-docs");
  assert.ok(!coreDocs.paths.includes("docs/threat-model.md"));
  const coreFiles = new Set(manifests.core.files.map(file => (file.vault ? `vault:${file.to}` : file.to)));
  for (const path of coreDocs.paths) assert.ok(coreFiles.has(path), path);
  const vaultDocs = standard.checks.find(check => check.id === "vault-docs");
  for (const path of vaultDocs.paths) assert.ok(coreFiles.has(`vault:${path.replace("{repo}/", "")}`), path);
});

test("expected values come from core's templates", () => {
  const ruleset = standard.expected.ruleset;
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.equal(ruleset.enforcement, "active");
  assert.deepEqual(ruleset.rules.find(rule => rule.type === "required_status_checks").parameters.required_status_checks, []);
  assert.deepEqual(standard.expected.securityFeatures.private, []);
  assert.ok(standard.expected.securityFeatures.public.includes("private_vulnerability_reporting"));
  assert.match(moduleDoc("core"), /private-vulnerability-reporting/);
  assert.deepEqual(standard.expected.actionsPermissions, { default_workflow_permissions: "read", can_approve_pull_request_reviews: false });
  assert.match(moduleDoc("core"), /actions\/permissions\/workflow --input \.bootstrap\/github\/actions-permissions\.json/);
});

function documentedSecrets() {
  const found = new Map();
  const note = (name, where) => found.set(name, [...(found.get(name) ?? []), where]);
  for (const name of names) {
    for (const line of moduleDoc(name).split("\n")) {
      for (const [, secret] of line.matchAll(/secret set ([A-Z][A-Z0-9_]+)/g)) note(secret, { module: name, env: line.match(/--env ([a-z]+)/)?.[1] ?? null });
    }
    const bootstrapTemplates = join(realModulesDir, name, "templates", "bootstrap");
    for (const file of existsSync(bootstrapTemplates) ? readdirSync(bootstrapTemplates).filter(f => f.startsWith("cloudflare-tokens")) : []) {
      const text = readFileSync(join(realModulesDir, name, "templates", "bootstrap", file), "utf8").replace(/\{\{fragment_[a-z0-9_]+\}\}/g, "");
      for (const entry of JSON.parse(text)) for (const env of entry.env ?? [null]) note(entry.secret, { module: name, env });
    }
  }
  const steps = join(scriptsDir, "secrets", "steps");
  for (const file of readdirSync(steps)) {
    const text = readFileSync(join(steps, file), "utf8");
    for (const line of text.split("\n").filter(l => !l.includes("variables:"))) {
      for (const [, secret] of line.matchAll(/(?:SECRET = |\{ name: |id: |secret: )"([A-Z][A-Z0-9_]+)"/g)) note(secret, { step: file });
    }
  }
  return found;
}

const declared = () => [...Object.values(manifests).flatMap(m => m.secrets ?? []), ...manifests.core.organisation.secrets];

test("every secret a module sets is declared in a manifest, and every declared secret is set somewhere", () => {
  const documented = documentedSecrets();
  const declaredNames = new Set(declared().map(secret => secret.name));
  for (const name of documented.keys()) assert.ok(declaredNames.has(name), `${name} is set but not declared`);
  for (const name of declaredNames) assert.ok(documented.has(name), `${name} is declared but nothing sets it`);
});

test("each secret's environment matches where the docs and token definitions set it", () => {
  const all = declared();
  for (const [name, places] of documentedSecrets()) {
    for (const place of places.filter(p => p.module && p.module !== "core")) {
      const scoped = all.filter(s => s.name === name && (place.env ? s.environment === place.env : (s.scope ?? "repository") === "repository"));
      assert.ok(scoped.length, `${name} in ${place.env ?? "the repository"} (${place.module}) has no matching declaration`);
    }
  }
  for (const secret of all) {
    if (secret.scope === "environment") assert.ok(secret.environment, secret.name);
    else assert.equal(secret.environment, undefined, secret.name);
  }
});

test("each declared environment is one its module's GitHub configuration creates", () => {
  for (const [name, manifest] of Object.entries(manifests)) {
    const section = moduleDoc(name).split("## 4. GitHub configuration")[1]?.split("\n## ")[0] ?? "";
    for (const environment of manifest.environments ?? []) assert.match(section, new RegExp(`\`${environment.name}\``), `${name}: ${environment.name}`);
  }
  const envs = Object.values(manifests).flatMap(m => m.environments ?? []).map(e => e.name);
  for (const secret of declared().filter(s => s.environment)) assert.ok(envs.includes(secret.environment), `${secret.name}: no environment ${secret.environment}`);
});

test("each App slug matches the name its secrets step creates", () => {
  const steps = join(scriptsDir, "secrets", "steps");
  const created = readdirSync(steps).flatMap(file =>
    [...readFileSync(join(steps, file), "utf8").matchAll(/name: `\$\{ctx\.(slug|owner)\}-([a-z-]+)`/g)].map(([, by, suffix]) => `{${by === "slug" ? "repo" : "owner"}}-${suffix}`),
  );
  const slugs = [...Object.values(manifests).flatMap(m => m.apps ?? []), ...manifests.core.organisation.apps].map(app => app.slug);
  assert.deepEqual([...new Set(created)].sort(), [...new Set(slugs)].sort());
});

test("every when names a boolean question, owner_org or private", () => {
  const known = new Set(["owner_org", "private", ...Object.values(manifests).flatMap(m => (m.questions ?? []).filter(q => q.type === "boolean").map(q => q.key))]);
  const walk = value => {
    if (Array.isArray(value)) return value.flatMap(walk);
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, item]) => (key === "when" ? [item].flat() : walk(item)));
  };
  for (const [name, manifest] of Object.entries(manifests)) {
    for (const condition of walk(manifest)) assert.ok(known.has(String(condition).replace(/^!/, "")), `${name}: when ${condition}`);
  }
});

test("standard.mjs --check passes on the committed file", () => {
  assert.equal(spawnSync("node", [script, "--check"]).status, 0);
});

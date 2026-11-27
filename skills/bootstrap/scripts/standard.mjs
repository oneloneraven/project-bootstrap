#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRequiredChecks } from "./conformance-rules.mjs";

export const STANDARD_VERSION = 2;
export const STANDARD_PATH = fileURLToPath(new URL("../../../conformance/standard.json", import.meta.url));
export const MODULES_DIR = fileURLToPath(new URL("../modules", import.meta.url));

const CONFORMANCE_CHECKS = [
  { id: "bootstrap-record", title: "Bootstrap record", kind: "record-present", modules: [], path: ".bootstrap/record.json" },
  { id: "ruleset", title: "Default branch ruleset", kind: "ruleset-matches", modules: ["core"], step: "github:core:4" },
  { id: "required-checks", title: "Required checks", kind: "required-checks", modules: ["core"], step: "github:core:4" },
  { id: "settings", title: "Repository settings", kind: "settings-match", modules: ["core"], step: "github:core:1" },
  { id: "labels", title: "Labels", kind: "labels-match", modules: ["core"], step: "github:core:3" },
  {
    id: "core-docs",
    title: "Security policy and core docs",
    kind: "files-present",
    modules: ["core"],
    paths: ["SECURITY.md", "CLAUDE.md", "docs/privacy.md", "docs/workflow.md", "docs/definition-of-done.md"],
  },
  {
    id: "vault-docs",
    title: "Private docs in the vault",
    kind: "vault-files-present",
    modules: ["core"],
    repository: "{owner}-vault",
    paths: ["{repo}/threat-model.md"],
    step: "github:core:vault",
  },
  { id: "dependabot", title: "Dependabot", kind: "dependabot", modules: ["core"], paths: [".github/dependabot.yml"] },
  { id: "board-sync", title: "Board sync", kind: "workflow-healthy", modules: ["core"], workflow: "project-status-sync.yml", step: "github:core:5" },
  { id: "release-gate", title: "Engage release gate", kind: "engage-protection-rule", modules: ["core"] },
  {
    id: "no-cloudflare-secret",
    title: "No long-lived Cloudflare secret",
    kind: "secrets-absent",
    modules: ["cloudflare-opentofu", "cloudflare-identity", "cloudflare-tofu-base"],
    names: ["CLOUDFLARE_API_TOKEN"],
  },
].map(check => ({ group: "conformance", ...check }));

const SECURITY_CHECKS = [
  { id: "ruleset-enforced", title: "Default branch ruleset enforced", kind: "ruleset-enforced", ruleset: "default-branch-protection", notExpected: { visibility: "private", plans: ["free"] } },
  { id: "visibility", title: "Visibility", kind: "visibility" },
  { id: "collaborators", title: "Owners only", kind: "collaborators-owners-only" },
  { id: "deploy-keys", title: "Deploy keys", kind: "deploy-keys-none" },
  { id: "webhooks", title: "Webhooks", kind: "webhooks-none" },
  { id: "security-features", title: "Security features", kind: "security-features" },
  { id: "actions-settings", title: "Actions workflow permissions", kind: "actions-permissions-match" },
  { id: "environments", title: "Environments", kind: "environments-match" },
  { id: "secrets-known", title: "Known secrets only", kind: "secrets-known" },
  { id: "org-members", title: "Organisation members", kind: "org-members", scope: "organisation" },
  { id: "org-2fa", title: "Organisation two-factor", kind: "org-2fa", scope: "organisation" },
  { id: "org-apps", title: "Organisation Apps", kind: "org-apps", scope: "organisation" },
  { id: "org-webhooks", title: "Organisation webhooks", kind: "org-webhooks-none", scope: "organisation" },
  { id: "org-secrets", title: "Organisation secrets", kind: "org-secrets-known", scope: "organisation" },
  { id: "org-settings", title: "Organisation settings", kind: "org-settings-match", scope: "organisation" },
].map(check => ({ group: "security", modules: [], scope: "repository", ...check }));

const readJson = path => JSON.parse(readFileSync(path, "utf8"));

function enabledFeatures(settings) {
  return Object.entries(settings.security_and_analysis ?? {})
    .filter(([, { status }]) => status === "enabled")
    .map(([name]) => name);
}

function byModule(manifests, key) {
  return Object.fromEntries(manifests.filter(m => m[key]?.length).map(m => [m.name, m[key]]));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

export const formatStandard = standard => `${JSON.stringify(sortKeys(standard), null, 2)}\n`;

export function generateStandard(modulesDir = MODULES_DIR) {
  const names = readdirSync(modulesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const manifests = names.map(name => ({ name, ...readJson(join(modulesDir, name, "manifest.json")) }));
  const templates = join(modulesDir, "core", "templates", "bootstrap");
  const ruleset = JSON.parse(readFileSync(join(templates, "ruleset.json"), "utf8").replace("{{required_checks_json}}", "[]"));
  const settings = { public: readJson(join(templates, "repo-settings.json")), private: readJson(join(templates, "repo-settings-private.json")) };
  const core = manifests.find(m => m.name === "core");
  return {
    version: STANDARD_VERSION,
    checks: [...CONFORMANCE_CHECKS, ...SECURITY_CHECKS],
    requiredChecks: generateRequiredChecks(modulesDir),
    expected: {
      ruleset,
      settings,
      securityFeatures: { public: [...enabledFeatures(settings.public), "private_vulnerability_reporting"], private: enabledFeatures(settings.private) },
      actionsPermissions: readJson(join(templates, "actions-permissions.json")),
      labels: readJson(join(templates, "labels.json")),
      environments: byModule(manifests, "environments"),
      secrets: byModule(manifests, "secrets"),
      apps: byModule(manifests, "apps"),
    },
    organisation: core.organisation,
  };
}

const withoutStamp = ({ bootstrap: _stamp, ...standard }) => standard;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const generated = generateStandard();
  if (args[0] === "--write") {
    writeFileSync(STANDARD_PATH, formatStandard(generated));
  } else if (args[0] === "--check") {
    if (!existsSync(STANDARD_PATH) || formatStandard(withoutStamp(readJson(STANDARD_PATH))) !== formatStandard(generated)) {
      console.error("conformance/standard.json is out of date: run node skills/bootstrap/scripts/standard.mjs --write");
      process.exit(1);
    }
  } else if (args[0] === "--release" && /^v\d+\.\d+\.\d+$/.test(args[1] ?? "")) {
    process.stdout.write(formatStandard({ ...generated, bootstrap: args[1] }));
  } else {
    console.error("Usage: standard.mjs --write | --check | --release <vX.Y.Z>");
    process.exit(2);
  }
}

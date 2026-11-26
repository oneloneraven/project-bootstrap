import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, files, realModulesDir, renderReal } from "./helpers.mjs";

const VAULT_KINDS = [
  /^docs\/adr\/(?!README\.md$)/,
  /^docs\/superpowers\//,
  /^docs\/runbooks\//,
  /^docs\/playbooks\//,
  /^docs\/threat-model\.md$/,
  /^docs\/dpia/i,
  /^docs\/[^/]*architecture[^/]*\.md$/,
  /^docs\/tech-stack\.md$/,
  /^infra\/README\.md$/,
];
const isVaultKind = path => VAULT_KINDS.some(kind => kind.test(path));

const COMBINATIONS = [
  [[], {}],
  [["js-toolchain"], {}],
  [["web-app"], {}],
  [["python-toolchain"], {}],
  [["android-toolchain"], { application_id: "org.example.sample" }],
  [["cloudflare-opentofu"], { zone_name: "example.test", beta: true, admin: true, admin_subdomain: "admin", turnstile: true, d1: true }],
  [["cloudflare-identity"], {}],
];

test("every manifest entry of a vault kind is staged for the vault", () => {
  for (const name of readdirSync(realModulesDir)) {
    const manifest = JSON.parse(readFileSync(join(realModulesDir, name, "manifest.json"), "utf8"));
    for (const file of manifest.files ?? []) assert.ok(file.vault || !isVaultKind(file.to), `${name}: ${file.to} is a vault kind`);
  }
});

for (const [selected, extra] of COMBINATIONS) {
  const label = selected.join(", ") || "core";

  test(`${label}: no vault document is rendered into the project`, () => {
    const dir = renderReal(selected, extra);
    const leaked = [...files(dir)].filter(path => !path.startsWith(".bootstrap/") && isVaultKind(path));
    assert.deepEqual(leaked, []);
  });

  test(`${label}: the staged vault docs have the threat model and no broken links among themselves`, () => {
    const staged = join(renderReal(selected, extra), ".bootstrap", "vault");
    assert.ok(existsSync(join(staged, "threat-model.md")));
    assert.deepEqual(brokenLinks(staged), []);
  });
}

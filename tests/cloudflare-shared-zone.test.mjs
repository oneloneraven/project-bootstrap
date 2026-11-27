import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { files, realModulesDir, renderReal } from "./helpers.mjs";
import { saveAnswers } from "../skills/bootstrap/scripts/state.mjs";

const shared = { zone_name: "example.test", zone_shared: true, app_subdomain: "watch-api", beta: false, admin: true, admin_subdomain: "watch", turnstile: false, d1: true };
const dir = renderReal(["cloudflare-opentofu"], shared);
const read = (root, path) => readFileSync(join(root, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
const patterns = config => Object.values(config.env).flatMap(env => (env.routes ?? []).map(route => route.pattern));
const ZONE_WIDE = /Zone Settings|Zone WAF|Cache Settings|Redirect|DNSSEC|Transform Rules/;

test("shared zone: no zone-wide resource is rendered", () => {
  for (const path of ["infra/security.tf", "infra/cache.tf", "infra/redirects.tf", "infra/dns.tf"]) assert.ok(!existsSync(join(dir, path)), path);
  for (const path of [...files(dir)].filter(file => /^infra\/[^/]+\.tf$/.test(file))) {
    assert.doesNotMatch(read(dir, path), /cloudflare_zone_setting|cloudflare_zone_dnssec|cloudflare_ruleset|"CAA"/, path);
  }
});

test("shared zone: the app and admin records are subdomains", () => {
  assert.match(read(dir, "infra/dns-shared.tf"), /resource "cloudflare_dns_record" "app" \{[^}]*name\s+= "watch-api\.\$\{var\.app_zone_name\}"/);
  assert.match(read(dir, "infra/dns-admin.tf"), /name\s+= "watch\.\$\{var\.app_zone_name\}"/);
});

test("shared zone: the Worker routes use the app host", () => {
  const routes = patterns(jsonc(read(dir, "wrangler.jsonc")));
  assert.deepEqual(routes, ["watch-api.example.test/*", "watch.example.test/*"]);
});

test("shared zone: the infra tokens hold DNS but no zone settings, WAF, cache, redirect or DNSSEC permissions", () => {
  const tokens = JSON.parse(read(dir, ".bootstrap/cloudflare/tokens.json"));
  const token = name => tokens.find(item => item.token === name).permissions;
  assert.ok(token("Infra plan").includes("DNS Read"));
  assert.ok(token("Infra apply").includes("DNS Write"));
  for (const item of tokens) assert.deepEqual(item.permissions.filter(permission => ZONE_WIDE.test(permission)), [], item.token);
  const readme = read(dir, ".bootstrap/vault/infra/README.md");
  for (const name of ["Infra plan", "Infra apply"]) {
    assert.doesNotMatch(readme.split("\n").find(line => line.startsWith(`| ${name} |`)), ZONE_WIDE, name);
  }
});

test("shared zone: the README leaves the zone's settings to the stack that owns it", () => {
  const readme = read(dir, ".bootstrap/vault/infra/README.md");
  assert.match(readme, /belong to the stack that manages it/);
  assert.doesNotMatch(readme, /DNSSEC|CAA|`www` redirect|dig \+short DS/);
});

test("shared zone with a beta: the beta host is a sibling of the app host", () => {
  const beta = renderReal(["cloudflare-opentofu"], { ...shared, beta: true });
  assert.deepEqual(patterns(jsonc(read(beta, "wrangler.jsonc"))), ["watch-api.example.test/*", "watch.example.test/*", "watch-api-beta.example.test/*"]);
  assert.match(read(beta, "infra/dns-beta.tf"), /name\s+= "watch-api-beta\.\$\{var\.app_zone_name\}"/);
});

test("unshared zone renders as before", () => {
  const unshared = renderReal(["cloudflare-opentofu"], { ...shared, zone_shared: false, beta: true });
  for (const path of ["infra/security.tf", "infra/cache.tf", "infra/redirects.tf", "infra/dns.tf", "infra/outputs.tf"]) assert.ok(existsSync(join(unshared, path)), path);
  assert.ok(!existsSync(join(unshared, "infra/dns-shared.tf")));
  assert.deepEqual(patterns(jsonc(read(unshared, "wrangler.jsonc"))), ["example.test/*", "watch.example.test/*", "beta.example.test/*"]);
  assert.match(read(unshared, "infra/dns-beta.tf"), /name\s+= "beta\.\$\{var\.app_zone_name\}"/);
  const tokens = JSON.parse(read(unshared, ".bootstrap/cloudflare/tokens.json"));
  assert.ok(tokens.find(item => item.token === "Infra apply").permissions.includes("Zone Settings Write"));
});

test("shared zone: the record has the flag", () => {
  const project = mkdtempSync(join(tmpdir(), "shared-zone-"));
  const base = JSON.parse(readFileSync(new URL("./fixtures/answers-core.json", import.meta.url), "utf8"));
  saveAnswers(project, { ...base, ...shared }, ["cloudflare-opentofu"], realModulesDir);
  assert.equal(JSON.parse(read(project, ".bootstrap/record.json")).flags.zone_shared, true);
});

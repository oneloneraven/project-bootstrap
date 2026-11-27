import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const extra = { zone_name: "example.test" };
const variants = {
  "admin with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: true, admin_subdomain: "admin" }),
  "admin without a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: true, admin_subdomain: "admin" }),
};
const plain = {
  "no admin with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: false }),
  "no admin without a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: false }),
};
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
const ADMIN_FILES = ["infra/dns-admin.tf", "src/lib/access.js", "test/lib/access.test.js"];

for (const [name, dir] of Object.entries(variants)) {
  test(`${name}: the admin record, route, vars, owner check, stub and tests are rendered`, () => {
    const rendered = [...files(dir)];
    for (const file of ADMIN_FILES) assert.ok(rendered.includes(file), file);
    const record = read(dir, "infra/dns-admin.tf");
    assert.match(record, /resource "cloudflare_dns_record" "app_admin"/);
    assert.match(record, /name\s*=\s*"admin\.\$\{var\.app_zone_name\}"/);
    assert.match(record, /content\s*=\s*"192\.0\.2\.1"/);
    assert.match(record, /proxied\s*=\s*true/);
    assert.match(record, /prevent_destroy = true/);
    const comment = record.match(/comment\s*=\s*"([^"]*)"/)[1];
    assert.ok(comment.length <= 100, comment);
    const production = jsonc(read(dir, "wrangler.jsonc")).env.production;
    assert.deepEqual(production.routes.map(route => route.pattern), ["example.test/*", "admin.example.test/*"]);
    assert.ok(production.routes.every(route => route.zone_name === "example.test"));
    assert.equal(production.vars.ADMIN_HOST, "admin.example.test");
    assert.match(read(dir, "src/worker.js"), /adminIdentity/);
    assert.match(read(dir, "src/worker.js"), /status: 404/);
    assert.match(read(dir, "test/worker.test.js"), /the admin host answers 404 to anyone the owner check refuses/);
    assert.match(read(dir, ".bootstrap/vault/infra/README.md"), /## Admin section/);
    assert.match(read(dir, ".dev.vars.example"), /^OWNER_EMAIL=$/m);
  });

  test(`${name}: the Access vars start empty so the check fails closed`, () => {
    const { vars } = jsonc(read(dir, "wrangler.jsonc")).env.production;
    assert.equal(vars.ACCESS_TEAM_DOMAIN, "");
    assert.equal(vars.ACCESS_AUD, "");
    assert.ok(!("OWNER_EMAIL" in vars));
    assert.doesNotMatch(read(dir, "wrangler.jsonc"), /OWNER_EMAIL/);
  });

  test(`${name}: the bypass is set in e2e and the local dev vars only, never in production, preview or beta`, () => {
    const config = jsonc(read(dir, "wrangler.jsonc"));
    assert.ok(!("ADMIN_ACCESS_CHECK" in config.vars));
    assert.match(read(dir, ".dev.vars.example"), /^ADMIN_ACCESS_CHECK=off$/m);
    assert.equal(config.env.e2e.vars.ADMIN_ACCESS_CHECK, "off");
    for (const [env, settings] of Object.entries(config.env)) {
      if (env === "e2e") continue;
      assert.ok(!("ADMIN_ACCESS_CHECK" in settings.vars), env);
      assert.ok(!("ADMIN_ACCESS_CHECK" in (settings.previews?.vars ?? {})), env);
    }
  });

  test(`${name}: no project token gains an Access or Turnstile permission`, () => {
    const tokens = JSON.parse(read(dir, ".bootstrap/cloudflare/tokens.json"));
    for (const token of tokens) for (const permission of token.permissions) assert.doesNotMatch(permission, /Access:|Turnstile|Zero Trust/i, `${token.token}: ${permission}`);
    assert.doesNotMatch(read(dir, ".bootstrap/vault/infra/README.md"), /Access: |Turnstile Sites/);
  });

  test(`${name}: every environment runs the Worker before static assets, so the owner check sees every request`, () => {
    const config = jsonc(read(dir, "wrangler.jsonc"));
    for (const [envName, env] of Object.entries({ top: config, ...config.env })) assert.equal(env.assets.run_worker_first, true, envName);
  });
}

test("a beta has no admin hostname, route or vars of its own", () => {
  const { env } = jsonc(read(variants["admin with a beta"], "wrangler.jsonc"));
  assert.deepEqual(env.beta.vars, { APP_ENV: "beta" });
  assert.ok(!("routes" in env.beta && env.beta.routes.some(route => /admin/.test(route.pattern))));
  assert.ok(![...files(variants["admin with a beta"])].includes("infra/dns-beta-admin.tf"));
});

test("the admin hostname follows the admin_subdomain answer", () => {
  const dir = renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: true, admin_subdomain: "console" });
  assert.match(read(dir, "infra/dns-admin.tf"), /name\s*=\s*"console\.\$\{var\.app_zone_name\}"/);
  const production = jsonc(read(dir, "wrangler.jsonc")).env.production;
  assert.deepEqual(production.routes.map(route => route.pattern), ["example.test/*", "console.example.test/*"]);
  assert.equal(production.vars.ADMIN_HOST, "console.example.test");
});

for (const [name, dir] of Object.entries(plain)) {
  test(`${name}: static assets are served without running the Worker first`, () => {
    const config = jsonc(read(dir, "wrangler.jsonc"));
    for (const [envName, env] of Object.entries({ top: config, ...config.env })) assert.equal(env.assets.run_worker_first, undefined, envName);
  });

  test(`${name}: none of the admin files, record, route, vars or text are rendered`, () => {
    const rendered = [...files(dir)];
    for (const file of ADMIN_FILES) assert.ok(!rendered.includes(file), file);
    const config = read(dir, "wrangler.jsonc");
    for (const text of ["ADMIN_HOST", "ACCESS_AUD", "ACCESS_TEAM_DOMAIN", "ADMIN_ACCESS_CHECK", "admin."]) assert.ok(!config.includes(text), text);
    assert.deepEqual(jsonc(config).env.production.routes.map(route => route.pattern), ["example.test/*"]);
    assert.doesNotMatch(read(dir, "src/worker.js"), /adminIdentity/);
    assert.doesNotMatch(read(dir, ".bootstrap/vault/infra/README.md"), /## Admin section/);
    assert.doesNotMatch(read(dir, ".dev.vars.example"), /OWNER_EMAIL|ADMIN_HOST/);
  });
}

test("the module asks for the admin hostname only when admin is yes", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/bootstrap/modules/cloudflare-opentofu/manifest.json", import.meta.url), "utf8"));
  const admin = manifest.questions.find(question => question.key === "admin");
  const subdomain = manifest.questions[manifest.questions.indexOf(admin) + 1];
  assert.deepEqual([admin.key, admin.type, subdomain.key, subdomain.type, subdomain.when], ["admin", "boolean", "admin_subdomain", "dns_label", "admin"]);
});

test("the module doc and standards describe the owner check and the manual steps", () => {
  const doc = readFileSync(new URL("../skills/bootstrap/modules/cloudflare-opentofu/MODULE.md", import.meta.url), "utf8");
  assert.match(doc, /### cloudflare-opentofu:3 Add the admin section to the identity stack/);
  assert.match(doc, /### cloudflare-opentofu:4 Set OWNER_EMAIL/);
  assert.match(doc, /gh secret set OWNER_EMAIL --env production --repo \$R/);
  assert.match(read(variants["admin without a beta"], "docs/coding-standards.md"), /An admin section is checked twice/);
});

const TEAM = "example.cloudflareaccess.com";
const AUD = "test-audience";
const NOW = 1_800_000_000;
const b64url = bytes => Buffer.from(bytes).toString("base64url");
const encode = value => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function ownerCheck() {
  const dir = variants["admin without a beta"];
  const access = await import(`${join(dir, "src/lib/access.js")}?${Math.random()}`);
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
  const fetchImpl = async () => Response.json({ keys: [jwk] });
  const sign = async (claims = {}, alg = "RS256") => {
    const header = encode({ alg, kid: "k1" });
    const payload = encode({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 300, email: "owner@example.test", ...claims });
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(signature)}`;
  };
  const env = { APP_ENV: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: "Owner@Example.test" };
  const check = async (token, overrides = {}) => access.adminIdentity(new Request("https://admin.example.test/", { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} }), { ...env, ...overrides }, { fetchImpl, nowS: NOW });
  return { access, sign, check };
}

test("the rendered owner check accepts the owner, and refuses another email, a missing token and missing configuration", async () => {
  const { sign, check } = await ownerCheck();
  assert.deepEqual(await check(await sign()), { email: "owner@example.test" });
  assert.equal(await check(await sign({ email: "other@example.test" })), null);
  assert.equal(await check(null), null);
  for (const key of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "OWNER_EMAIL"]) assert.equal(await check(await sign(), { [key]: "" }), null, key);
});

test("the rendered owner check refuses each failed claim, a future nbf and any algorithm but RS256", async () => {
  const { sign, check } = await ownerCheck();
  assert.equal(await check(await sign({ aud: ["other"] })), null);
  assert.equal(await check(await sign({ iss: "https://evil.cloudflareaccess.com" })), null);
  assert.equal(await check(await sign({ exp: NOW - 61 })), null);
  assert.equal(await check(await sign({ nbf: NOW + 61 })), null);
  assert.deepEqual(await check(await sign({ nbf: NOW + 59 })), { email: "owner@example.test" });
  assert.deepEqual(await check(await sign({ aud: AUD })), { email: "owner@example.test" });
  assert.equal(await check(await sign({}, "HS256")), null);
  assert.equal(await check(await sign({}, "none")), null);
});

test("the rendered owner check skips only in e2e and development, and only when the bypass is off", async () => {
  const { check } = await ownerCheck();
  const off = { ADMIN_ACCESS_CHECK: "off", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", OWNER_EMAIL: "" };
  for (const APP_ENV of ["e2e", "development"]) assert.deepEqual(await check(null, { ...off, APP_ENV }), { email: "dev@localhost" }, APP_ENV);
  for (const APP_ENV of ["production", "beta", "preview"]) assert.equal(await check(null, { ...off, APP_ENV }), null, APP_ENV);
  assert.equal(await check(null, { ...off, APP_ENV: "e2e", ADMIN_ACCESS_CHECK: "on" }), null);
});

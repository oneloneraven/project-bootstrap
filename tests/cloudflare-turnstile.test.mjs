import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const extra = { zone_name: "example.test" };
const variants = {
  "turnstile with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: false, turnstile: true }),
  "turnstile without a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: false, turnstile: true }),
  "turnstile and admin with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: true, admin_subdomain: "admin", turnstile: true }),
};
const plain = {
  "no turnstile with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: false, turnstile: false }),
  "no turnstile without a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: false, turnstile: false }),
  "no turnstile with admin": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, admin: true, admin_subdomain: "admin", turnstile: false }),
};
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
const moduleFile = path => readFileSync(new URL(`../skills/bootstrap/modules/cloudflare-opentofu/${path}`, import.meta.url), "utf8");
const TURNSTILE_FILES = ["src/lib/turnstile.js", "test/lib/turnstile.test.js"];
const WORKFLOW = ".github/workflows/sync-worker-secrets.yml";
const TEST_SITEKEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

for (const [name, dir] of Object.entries(variants)) {
  test(`${name}: the library, its tests and the sync workflow are rendered`, () => {
    const rendered = [...files(dir)];
    for (const file of [...TURNSTILE_FILES, WORKFLOW]) assert.ok(rendered.includes(file), file);
    assert.match(read(dir, ".bootstrap/vault/infra/README.md"), /## Turnstile/);
  });

  test(`${name}: production's sitekey starts empty so verification fails closed, and its secret is never a var`, () => {
    const config = jsonc(read(dir, "wrangler.jsonc"));
    assert.equal(config.env.production.vars.TURNSTILE_SITEKEY, "");
    assert.ok(!("TURNSTILE_SECRET_KEY" in config.env.production.vars));
    assert.ok(!("TURNSTILE_SITEKEY" in config.vars));
    assert.ok(!("TURNSTILE_SECRET_KEY" in config.vars));
  });

  test(`${name}: preview, its Preview and e2e use Cloudflare's always-pass test keys`, () => {
    const { env } = jsonc(read(dir, "wrangler.jsonc"));
    for (const vars of [env.preview.vars, env.preview.previews.vars, env.e2e.vars]) {
      assert.equal(vars.TURNSTILE_SITEKEY, TEST_SITEKEY);
      assert.equal(vars.TURNSTILE_SECRET_KEY, TEST_SECRET);
    }
    assert.deepEqual(env.preview.previews.vars, env.preview.vars);
    const example = read(dir, ".dev.vars.example");
    assert.match(example, new RegExp(`^TURNSTILE_SITEKEY=${TEST_SITEKEY}$`, "m"));
    assert.match(example, new RegExp(`^TURNSTILE_SECRET_KEY=${TEST_SECRET}$`, "m"));
  });
}

test("with a beta the workflow sets the secret on production and beta", () => {
  for (const name of ["turnstile with a beta", "turnstile and admin with a beta"]) {
    const text = read(variants[name], WORKFLOW);
    const puts = [...text.matchAll(/^ {10}printf '%s' "\$TURNSTILE_SECRET_KEY" \| pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env (\w+)$/gm)].map(match => match[1]);
    assert.deepEqual(puts, ["production", "beta"], name);
  }
});

test("without a beta the workflow sets the secret on production only", () => {
  const text = read(variants["turnstile without a beta"], WORKFLOW);
  const puts = [...text.matchAll(/wrangler secret put TURNSTILE_SECRET_KEY --env (\w+)/g)].map(match => match[1]);
  assert.deepEqual(puts, ["production"]);
  assert.doesNotMatch(text, /--env beta/);
});

test("a beta's vars carry the empty sitekey and nothing else new", () => {
  const { env } = jsonc(read(variants["turnstile with a beta"], "wrangler.jsonc"));
  assert.deepEqual(env.beta.vars, { APP_ENV: "beta", TURNSTILE_SITEKEY: "" });
  assert.deepEqual(jsonc(read(variants["turnstile without a beta"], "wrangler.jsonc")).env.beta, undefined);
});

test("turnstile and admin together keep both sets of vars", () => {
  const dir = variants["turnstile and admin with a beta"];
  const { env } = jsonc(read(dir, "wrangler.jsonc"));
  assert.equal(env.production.vars.ADMIN_HOST, "admin.example.test");
  assert.equal(env.production.vars.TURNSTILE_SITEKEY, "");
  assert.equal(env.e2e.vars.ADMIN_ACCESS_CHECK, "off");
  assert.equal(env.e2e.vars.TURNSTILE_SITEKEY, TEST_SITEKEY);
  const example = read(dir, ".dev.vars.example");
  assert.match(example, /^OWNER_EMAIL=$/m);
  assert.match(example, /^TURNSTILE_SECRET_KEY=/m);
  assert.match(read(dir, ".bootstrap/vault/infra/README.md"), /## Admin section[\s\S]*## Turnstile[\s\S]*## Disaster recovery/);
});

test("the README covers the widget, the secret and the rotation end to end", () => {
  const readme = read(variants["turnstile with a beta"], ".bootstrap/vault/infra/README.md");
  const section = readme.slice(readme.indexOf("## Turnstile"), readme.indexOf("## Disaster recovery"));
  assert.match(section, /widget_sitekey/);
  assert.match(section, /gh secret set TURNSTILE_SECRET_KEY --env production/);
  assert.match(section, /Rotate a Turnstile widget secret/);
  assert.match(section, /Sync Worker secrets/);
  assert.match(section, /grace period/);
  assert.match(section, /invalidate_immediately/);
});

test("the README says what is logged and that the secret, token and IP never are", () => {
  const readme = read(variants["turnstile with a beta"], ".bootstrap/vault/infra/README.md");
  const section = readme.slice(readme.indexOf("## Turnstile"), readme.indexOf("## Disaster recovery"));
  assert.match(section, /turnstile\.unavailable/);
  assert.match(section, /secret, the token and the client IP are\s+never logged/);
});

for (const [name, dir] of Object.entries(plain)) {
  test(`${name}: none of the library, tests, secret step, vars or text are rendered`, () => {
    const rendered = [...files(dir)];
    for (const file of TURNSTILE_FILES) assert.ok(!rendered.includes(file), file);
    if (rendered.includes(WORKFLOW)) assert.doesNotMatch(read(dir, WORKFLOW), /TURNSTILE/);
    for (const text of [read(dir, "wrangler.jsonc"), read(dir, ".dev.vars.example"), read(dir, ".bootstrap/vault/infra/README.md")]) assert.doesNotMatch(text, /TURNSTILE|## Turnstile/);
    assert.ok(!jsonc(read(dir, "wrangler.jsonc")).env.production.vars.TURNSTILE_SITEKEY);
    assert.ok(!jsonc(read(dir, "wrangler.jsonc")).env.preview.previews.vars.TURNSTILE_SITEKEY);
  });
}

test("the module asks about turnstile as a plain boolean", () => {
  const manifest = JSON.parse(moduleFile("manifest.json"));
  const question = manifest.questions.find(item => item.key === "turnstile");
  assert.equal(question.type, "boolean");
  assert.equal(question.when, undefined);
  assert.match(question.prompt, /Turnstile/);
  for (const file of manifest.files.filter(item => TURNSTILE_FILES.includes(item.to))) assert.equal(file.when, "turnstile", file.to);
  for (const file of manifest.files.filter(item => item.to.startsWith("src/lib/turnstile") || item.to.startsWith("test/lib/turnstile"))) assert.equal(file.stage, "app", file.to);
});

test("the module doc describes the manual steps, only with turnstile", () => {
  const doc = moduleFile("MODULE.md");
  const sixth = doc.slice(doc.indexOf("### cloudflare-opentofu:6 "), doc.indexOf("### cloudflare-opentofu:7 "));
  const seventh = doc.slice(doc.indexOf("### cloudflare-opentofu:7 "), doc.indexOf("## 6. Standards"));
  assert.match(sixth, /^### cloudflare-opentofu:6 Add the Turnstile widget to the identity stack\n\nOnly with `turnstile`\./);
  assert.match(sixth, /`widgets`/);
  assert.match(sixth, /widget_sitekey/);
  assert.match(sixth, /TURNSTILE_SITEKEY/);
  assert.match(seventh, /^### cloudflare-opentofu:7 Set the widget secret\n\nOnly with `turnstile`\./);
  assert.match(seventh, /gh secret set TURNSTILE_SECRET_KEY --env production --repo \$R/);
  assert.match(seventh, /gh workflow run sync-worker-secrets\.yml --repo \$R --ref main/);
  assert.match(seventh, /wrangler secret list --env production/);
  assert.ok(doc.indexOf("### cloudflare-opentofu:5 ") < doc.indexOf("### cloudflare-opentofu:6 "));
});

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function turnstile() {
  const module = await import(`${join(variants["turnstile without a beta"], "src/lib/turnstile.js")}?${Math.random()}`);
  return module.verifyTurnstile;
}

const env = { TURNSTILE_SECRET_KEY: "secret", TURNSTILE_SITEKEY: "sitekey" };

async function withFetch(stub, run) {
  const original = globalThis.fetch;
  const warn = console.warn;
  globalThis.fetch = stub;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    console.warn = warn;
  }
}

test("the rendered library accepts only an explicit success and posts the documented JSON", async () => {
  const verifyTurnstile = await turnstile();
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ success: true });
  };
  assert.equal(await withFetch(stub, () => verifyTurnstile("token", "203.0.113.9", env)), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { secret: "secret", response: "token", remoteip: "203.0.113.9" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("the rendered library refuses a missing token, secret or sitekey without calling out", async () => {
  const verifyTurnstile = await turnstile();
  let called = 0;
  const stub = async () => {
    called += 1;
    return Response.json({ success: true });
  };
  for (const [token, overrides] of [["", {}], [undefined, {}], ["token", { TURNSTILE_SECRET_KEY: "" }], ["token", { TURNSTILE_SECRET_KEY: undefined }], ["token", { TURNSTILE_SITEKEY: "" }], ["token", { TURNSTILE_SITEKEY: undefined }]]) {
    assert.equal(await withFetch(stub, () => verifyTurnstile(token, "203.0.113.9", { ...env, ...overrides })), false, JSON.stringify([token, overrides]));
  }
  assert.equal(called, 0);
});

test("the rendered library refuses a non-OK response, a failed fetch, a timeout and any answer but success true", async () => {
  const verifyTurnstile = await turnstile();
  const ask = stub => withFetch(stub, () => verifyTurnstile("token", "203.0.113.9", env));
  assert.equal(await ask(async () => new Response("down", { status: 500 })), false);
  assert.equal(await ask(async () => Response.json({ success: true }, { status: 403 })), false);
  assert.equal(await ask(async () => { throw new TypeError("network"); }), false);
  assert.equal(await ask(async () => { throw new DOMException("timed out", "TimeoutError"); }), false);
  assert.equal(await ask(async () => new Response("not json")), false);
  for (const body of [{ success: false }, {}, { success: "true" }, { success: 1 }, { success: null }, null, []]) assert.equal(await ask(async () => Response.json(body)), false, JSON.stringify(body));
});

test("the rendered library gives the request a five second timeout", async () => {
  const verifyTurnstile = await turnstile();
  const timeouts = [];
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ms => {
    timeouts.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await withFetch(async () => Response.json({ success: true }), () => verifyTurnstile("token", "203.0.113.9", env));
  } finally {
    AbortSignal.timeout = original;
  }
  assert.deepEqual(timeouts, [5000]);
});

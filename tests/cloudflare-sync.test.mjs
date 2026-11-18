import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const WORKFLOW = ".github/workflows/sync-worker-secrets.yml";
const SECRETS = { admin: "OWNER_EMAIL", turnstile: "TURNSTILE_SECRET_KEY" };
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const moduleFile = path => readFileSync(new URL(`../skills/bootstrap/modules/cloudflare-opentofu/${path}`, import.meta.url), "utf8");

const cases = [];
for (const admin of [false, true]) {
  for (const turnstile of [false, true]) {
    for (const beta of [false, true]) {
      const name = `${admin ? "admin" : "no admin"}, ${turnstile ? "turnstile" : "no turnstile"}, ${beta ? "with" : "without"} a beta`;
      const answers = { zone_name: "example.test", beta, admin, turnstile, ...(admin && { admin_subdomain: "admin" }) };
      cases.push({ name, admin, turnstile, beta, dir: renderReal(["cloudflare-opentofu"], answers) });
    }
  }
}

function steps(text) {
  const body = text.slice(text.indexOf("    steps:\n") + "    steps:\n".length);
  return body.split(/^(?= {6}- )/m).filter(Boolean);
}

const secretSteps = text => steps(text).filter(step => /^ {6}- name: Set \w+ on the Worker$/m.test(step));
const expected = ({ admin, turnstile }) => [admin && "OWNER_EMAIL", turnstile && "TURNSTILE_SECRET_KEY"].filter(Boolean);

for (const item of cases) {
  const { name, dir } = item;
  const wanted = expected(item);

  test(`${name}: the workflow is rendered only when a secret needs syncing`, () => {
    assert.equal([...files(dir)].includes(WORKFLOW), wanted.length > 0);
  });

  if (!wanted.length) continue;

  test(`${name}: the workflow is manual only, main only, in production, read-only and serialised`, () => {
    const text = read(dir, WORKFLOW);
    assert.match(text, /^name: Sync Worker secrets$/m);
    assert.match(text, /^on:\n {2}workflow_dispatch:\n\npermissions:\n {2}contents: read\n/m);
    assert.doesNotMatch(text, /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run):/m);
    assert.match(text, /^concurrency:\n {2}group: sync-worker-secrets\n {2}cancel-in-progress: false$/m);
    assert.equal(text.match(/^ {4}if: github\.ref == 'refs\/heads\/main'$/gm).length, 1);
    assert.equal(text.match(/^ {4}environment: production$/gm).length, 1);
    assert.deepEqual(text.slice(text.indexOf("\njobs:\n")).match(/^ {2}\w[\w-]*:$/gm), ["  sync:"]);
    assert.match(text, /actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}persist-credentials: false/);
    assert.match(text, /uses: \$\/\.github\/actions\/setup-node-pnpm/);
  });

  test(`${name}: there is one step per secret the project has, in order`, () => {
    const text = read(dir, WORKFLOW);
    assert.deepEqual(secretSteps(text).map(step => step.match(/- name: Set (\w+) on the Worker/)[1]), wanted);
    assert.equal(steps(text).length, 2 + wanted.length);
  });

  test(`${name}: each secret is in its own step's env only, passed on stdin and checked for empty`, () => {
    const text = read(dir, WORKFLOW);
    for (const secret of Object.values(SECRETS)) {
      const mentions = text.split("\n").filter(line => line.includes(secret));
      if (!wanted.includes(secret)) {
        assert.equal(mentions.length, 0, secret);
        continue;
      }
      assert.equal(text.split("\n").filter(line => line.includes(`secrets.${secret}`)).length, 1, secret);
    }
    for (const step of secretSteps(text)) {
      const secret = step.match(/- name: Set (\w+) on the Worker/)[1];
      const others = Object.values(SECRETS).filter(other => other !== secret);
      for (const other of others) assert.ok(!step.includes(other), `${secret} step mentions ${other}`);
      assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_DEPLOY_TOKEN \}\}/);
      assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
      assert.match(step, new RegExp(`^ {10}${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}$`, "m"));
      const run = step.slice(step.indexOf("        run: |\n"));
      assert.doesNotMatch(run, /\$\{\{/);
      assert.match(run, /^ {10}set -euo pipefail$/m);
      assert.match(run, new RegExp(`^ {10}if \\[ -z "\\$${secret}" \\]; then$`, "m"));
      assert.match(run, new RegExp(`::error::${secret} is empty`));
      assert.match(run, /^ {12}exit 1$/m);
      const mentionsOfSecret = run.split("\n").filter(line => line.includes(`$${secret}`));
      const puts = mentionsOfSecret.filter(line => /\| pnpm exec wrangler secret put/.test(line));
      assert.ok(puts.length >= 1);
      for (const line of puts) assert.match(line, new RegExp(`^ {10}printf '%s' "\\$${secret}" \\| pnpm exec wrangler secret put ${secret} --env (production|beta)$`));
      assert.equal(mentionsOfSecret.length, puts.length + 1);
    }
  });

  test(`${name}: the workflow never prints, traces or writes a secret anywhere`, () => {
    const text = read(dir, WORKFLOW);
    assert.doesNotMatch(text, /set -[a-z]*x|xtrace|GITHUB_STEP_SUMMARY|GITHUB_OUTPUT|GITHUB_ENV|tee |>>|--debug|ACTIONS_STEP_DEBUG/);
    for (const line of text.split("\n").filter(item => /\becho\b/.test(item))) assert.doesNotMatch(line, /\$/);
    assert.doesNotMatch(text, /wrangler secret put \w+ <</);
    assert.doesNotMatch(text, /wrangler secret bulk/);
  });

  test(`${name}: each secret targets production, and beta only for turnstile with a beta`, () => {
    const text = read(dir, WORKFLOW);
    const targets = secret => [...text.matchAll(new RegExp(`wrangler secret put ${secret} --env (\\w+)`, "g"))].map(match => match[1]);
    assert.deepEqual(targets("OWNER_EMAIL"), item.admin ? ["production"] : []);
    assert.deepEqual(targets("TURNSTILE_SECRET_KEY"), item.turnstile ? (item.beta ? ["production", "beta"] : ["production"]) : []);
    if (!item.turnstile) assert.doesNotMatch(text, /--env beta/);
  });

  test(`${name}: the workflow is valid YAML`, () => {
    const script = "import sys, yaml; d = yaml.safe_load(open(sys.argv[1])); j = d['jobs']; assert list(j) == ['sync']; assert d['permissions'] == {'contents': 'read'}; print(len(j['sync']['steps']))";
    const result = spawnSync("python3", ["-I", "-c", script, join(dir, WORKFLOW)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Number(result.stdout), 2 + wanted.length);
  });
}

const refsLine = text => text.slice(text.indexOf("1. The deploy environments"), text.indexOf("## 5. Manual steps"));

test("the module doc gives production the main branch whenever a beta, admin or turnstile is on", () => {
  const section = refsLine(moduleFile("MODULE.md"));
  assert.match(section, /`production`: `main` and tags `v\*` with a beta, `admin` or `turnstile`/);
  assert.match(section, /tags `v\*`\s+only with none of them/);
  assert.match(section, /`\["branch:main","tag:v\*"\]` for\s+`production` with a beta, `admin` or `turnstile`/);
  assert.match(section, /`\["tag:v\*"\]` for `production`\s+with none of them and for `beta`/);
});

test("the workflow is declared for admin or turnstile", () => {
  const manifest = JSON.parse(moduleFile("manifest.json"));
  assert.deepEqual(manifest.files.find(file => file.to === WORKFLOW).when, ["admin", "turnstile"]);
  assert.equal(manifest.fragments.sync_owner_email.when, "admin");
  assert.equal(manifest.fragments.sync_turnstile.when, "turnstile");
  assert.equal(manifest.fragments.turnstile_sync_beta.when, "beta");
});

test("the owner email step of the module doc sets it through the environment secret and the workflow", () => {
  const doc = moduleFile("MODULE.md");
  const step = doc.slice(doc.indexOf("### cloudflare-opentofu:4 "), doc.indexOf("### cloudflare-opentofu:5 "));
  assert.match(step, /^### cloudflare-opentofu:4 Set OWNER_EMAIL\n\nOnly with `admin`\./);
  assert.match(step, /gh secret set OWNER_EMAIL --env production --repo \$R/);
  assert.match(step, /hidden/);
  assert.match(step, /never\s+paste\s+it\s+into\s+chat/);
  assert.match(step, /gh workflow run sync-worker-secrets\.yml --repo \$R --ref main/);
  assert.match(step, /gh run watch --repo \$R --exit-status/);
  assert.match(step, /\*\*Verify \(Claude runs\):\*\*[^]*wrangler secret list --env production/);
  assert.match(step, /`OWNER_EMAIL` is listed/);
});

test("no manual step or README fragment tells anyone to run wrangler secret put", () => {
  const doc = moduleFile("MODULE.md");
  const manual = doc.slice(doc.indexOf("## 5. Manual steps"), doc.indexOf("## 6. Standards"));
  assert.doesNotMatch(manual, /wrangler secret put/);
  for (const path of ["templates/fragments/admin-readme.md", "templates/fragments/turnstile-readme.md", "templates/fragments/sync-secrets-readme.md"]) {
    assert.doesNotMatch(moduleFile(path), /wrangler secret put/, path);
  }
  for (const item of cases.filter(({ admin, turnstile }) => admin || turnstile)) {
    const readme = read(item.dir, "infra/README.md");
    assert.doesNotMatch(readme.replace(/Set each runtime secret once per environment with\n`pnpm exec wrangler secret put <NAME> --env <env>`\./, ""), /wrangler secret put/, item.name);
  }
});

test("the admin and turnstile README sections describe one path: an environment secret, then Sync Worker secrets", () => {
  const dir = cases.find(item => item.admin && item.turnstile && item.beta).dir;
  const readme = read(dir, "infra/README.md");
  const admin = readme.slice(readme.indexOf("## Admin section"), readme.indexOf("## Turnstile"));
  assert.match(admin, /gh secret set OWNER_EMAIL --env production/);
  assert.match(admin, /Sync Worker\s+secrets/);
  assert.match(admin, /wrangler secret list --env production/);
  const workers = readme.slice(readme.indexOf("### Worker secrets"), readme.indexOf("## Admin section"));
  assert.match(workers, /Sync Worker\s+secrets/);
});

test("the standards say Worker secrets reach the Worker only through the sync workflow", () => {
  const standards = moduleFile("templates/standards-fragment.md");
  assert.match(standards, /Worker secrets reach the Worker only through the manual "Sync Worker\s+secrets" workflow/);
  assert.match(standards, /never printed or written to a\s+summary/);
  const dir = cases.find(item => item.admin).dir;
  assert.match(read(dir, "docs/coding-standards.md"), /Worker secrets reach the Worker only through/);
  assert.doesNotMatch(standards, /wrangler secret put/);
});

test("a project with neither option has no workflow and keeps the generic Worker secrets text", () => {
  const dir = cases.find(item => !item.admin && !item.turnstile && !item.beta).dir;
  assert.ok(![...files(dir)].includes(WORKFLOW));
  assert.doesNotMatch(read(dir, "infra/README.md"), /Sync Worker secrets/);
  assert.match(read(dir, "infra/README.md"), /wrangler secret put <NAME> --env <env>/);
});

test("a full project with a beta, admin and turnstile renders a workflow that parses and a wrangler.jsonc that is valid JSONC", () => {
  const dir = renderReal(["core", "js-toolchain", "web-app", "cloudflare-opentofu"], { zone_name: "example.test", beta: true, admin: true, admin_subdomain: "admin", turnstile: true });
  const script = [
    "import sys, yaml",
    "d = yaml.safe_load(open(sys.argv[1]))",
    "steps = d['jobs']['sync']['steps']",
    "assert [s.get('name') for s in steps[2:]] == ['Set OWNER_EMAIL on the Worker', 'Set TURNSTILE_SECRET_KEY on the Worker']",
    "assert d['jobs']['sync']['environment'] == 'production'",
    "assert 'OWNER_EMAIL' not in steps[3]['env'] and 'TURNSTILE_SECRET_KEY' not in steps[2]['env']",
    "print('ok')",
  ].join("\n");
  const parsed = spawnSync("python3", ["-I", "-c", script, join(dir, WORKFLOW)], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout.trim(), "ok");
  const config = JSON.parse(readFileSync(join(dir, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(Object.keys(config.env).sort(), ["beta", "e2e", "preview", "production"]);
  const text = read(dir, WORKFLOW);
  assert.match(text, /wrangler secret put OWNER_EMAIL --env production/);
  assert.equal(text.match(/wrangler secret put TURNSTILE_SECRET_KEY --env beta/g).length, 1);
});

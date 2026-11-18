import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brokenLinks, renderReal } from "./helpers.mjs";

const extra = { zone_name: "example.test" };
const withBeta = renderReal(["cloudflare-opentofu"], { ...extra, beta: true });
const noBeta = renderReal(["cloudflare-opentofu"], { ...extra, beta: false });
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

test("cloudflare-opentofu pulls in web-app and js-toolchain and adds wrangler", () => {
  const pkg = JSON.parse(read(withBeta, "package.json"));
  assert.ok(pkg.devDependencies.webdriverio);
  assert.ok(pkg.devDependencies.wrangler);
  assert.match(pkg.scripts["e2e:server"], /wrangler dev --env e2e/);
  assert.match(read(withBeta, "pnpm-workspace.yaml"), /\n  "workerd": true/);
});

test("beta adds a beta environment, its DNS record and the promote workflow", () => {
  assert.ok(jsonc(read(withBeta, "wrangler.jsonc")).env.beta);
  assert.ok(existsSync(join(withBeta, "infra/dns-beta.tf")));
  assert.ok(existsSync(join(withBeta, ".github/workflows/promote.yml")));
  assert.match(read(withBeta, ".github/workflows/deploy.yml"), /--env beta/);
});

test("without beta there is no beta environment and tags deploy to production", () => {
  assert.equal(jsonc(read(noBeta, "wrangler.jsonc")).env.beta, undefined);
  assert.ok(!existsSync(join(noBeta, "infra/dns-beta.tf")));
  assert.ok(!existsSync(join(noBeta, ".github/workflows/promote.yml")));
  assert.match(read(noBeta, ".github/workflows/deploy.yml"), /--env production/);
  assert.doesNotMatch(read(noBeta, ".github/workflows/deploy.yml"), /--env beta/);
});

test("every environment repeats the assets binding and only preview has workers.dev", () => {
  const config = jsonc(read(withBeta, "wrangler.jsonc"));
  assert.equal(config.workers_dev, false);
  for (const [name, env] of Object.entries(config.env)) {
    assert.equal(env.assets?.binding, "ASSETS", name);
    assert.equal(env.workers_dev === true, name === "preview", name);
  }
});

const PREVIEW_BINDINGS = ["vars", "kv_namespaces", "d1_databases", "r2_buckets", "durable_objects", "ratelimits", "send_email", "version_metadata", "services", "queues"];

test("a Preview repeats every binding of env.preview, because it inherits nothing", () => {
  for (const dir of [withBeta, noBeta]) {
    const { preview } = jsonc(read(dir, "wrangler.jsonc")).env;
    assert.ok(preview.previews, "env.preview.previews");
    assert.deepEqual(preview.previews.vars, { APP_ENV: "preview" });
    for (const key of PREVIEW_BINDINGS.filter(name => name in preview)) assert.deepEqual(preview.previews[key], preview[key], key);
  }
});

test("the Preview upload posts the URL, and prints wrangler's stderr and stdout when it fails", () => {
  const workflow = read(withBeta, ".github/workflows/preview.yml");
  const start = workflow.indexOf("set -euo pipefail\n          ERR=");
  const script = workflow
    .slice(start, workflow.indexOf("      - name: Comment the Preview URL"))
    .split("\n")
    .map(line => line.replace(/^ {10}/, ""))
    .join("\n");
  const scratch = mkdtempSync(join(tmpdir(), "preview-"));
  mkdirSync(join(scratch, "bin"));
  writeFileSync(join(scratch, "bin", "pnpm"), 'printf "%s" "$FAKE_STDOUT"\nprintf "%s" "$FAKE_STDERR" >&2\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 });
  const run = ({ stdout = "", stderr = "", exit = 0 }) => {
    const output = join(scratch, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${join(scratch, "bin")}:${process.env.PATH}`, RUNNER_TEMP: scratch, PR_NUMBER: "1", GITHUB_OUTPUT: output, FAKE_STDOUT: stdout, FAKE_STDERR: stderr, FAKE_EXIT: String(exit) },
      encoding: "utf8",
    });
    return { ...result, written: readFileSync(output, "utf8") };
  };
  const json = '{\n  "preview": {\n    "urls": [\n      "https://pr-1.example.test"\n    ]\n  }\n}\n';

  const ok = run({ stdout: json, stderr: "a warning\n" });
  assert.equal(ok.status, 0);
  assert.equal(ok.written, "url=https://pr-1.example.test\n");

  const failed = run({ stdout: "partial\n", stderr: "Authentication error [code: 10000]\n", exit: 1 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Authentication error/);
  assert.match(failed.stderr, /partial/);
  assert.equal(failed.written, "");

  const none = run({ stdout: "no json here\n", stderr: "something odd\n" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /something odd/);
  assert.match(none.stderr, /no json here/);
  assert.match(none.stdout, /::error::wrangler didn't report a Preview URL/);
});

test("infra and wrangler config can never ride a release: none", () => {
  const cfg = JSON.parse(read(withBeta, ".github/release-paths.json"));
  for (const path of ["infra/", "wrangler.jsonc"]) assert.ok(cfg.noneForbidden.includes(path), path);
});

test("state lives in the project's own R2 bucket", () => {
  assert.match(read(withBeta, "infra/main.tf"), /bucket\s*=\s*"sample-project-tfstate"/);
});

test("data-bearing records are protected from destroy", () => {
  assert.match(read(withBeta, "infra/dns.tf"), /prevent_destroy = true/);
});

test("the infra README covers setup, disaster recovery and teardown", () => {
  const readme = read(withBeta, "infra/README.md");
  for (const heading of ["## Setup", "## Disaster recovery", "## Teardown"]) assert.ok(readme.includes(heading), heading);
});

test("links resolve with both stack modules", () => {
  assert.deepEqual(brokenLinks(withBeta), []);
});

test("infrastructure runs on OpenTofu", () => {
  const infra = read(withBeta, ".github/workflows/infra.yml");
  assert.match(infra, /opentofu\/setup-opentofu@[0-9a-f]{40} # v2/);
  assert.match(infra, /run: tofu plan/);
  assert.doesNotMatch(infra, /terraform (init|plan|apply)/);
  assert.match(read(withBeta, "infra/README.md"), /OpenTofu/);
});

test("OpenTofu is pinned through a scaffold token and no other version is carried", () => {
  const infra = read(withBeta, ".github/workflows/infra.yml");
  assert.match(infra, /tofu_version: "@@TOFU_VERSION@@"/);
  const tokens = new Set();
  for (const dir of [withBeta, noBeta]) {
    for (const file of readdirSync(join(dir, ".github/workflows"))) {
      for (const [token] of read(dir, `.github/workflows/${file}`).matchAll(/@@[A-Z0-9_]+@@/g)) tokens.add(token);
    }
  }
  assert.deepEqual([...tokens], ["@@TOFU_VERSION@@"]);
});

const moduleDoc = readFileSync(new URL("../skills/bootstrap/modules/cloudflare-opentofu/MODULE.md", import.meta.url), "utf8");
const baseDoc = readFileSync(new URL("../skills/bootstrap/modules/cloudflare-tofu-base/MODULE.md", import.meta.url), "utf8");
const skillDoc = readFileSync(new URL("../skills/bootstrap/SKILL.md", import.meta.url), "utf8");
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, heading);
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next < 0 ? undefined : next);
};

test("environments are created on every plan and each is verified after creation", () => {
  const config = section(baseDoc, "## 4. GitHub configuration");
  assert.match(config, /on every plan/);
  assert.match(config, /gh api repos\/\$R\/environments\/<env> --jq '\.deployment_branch_policy'/);
  assert.match(config, /"custom_branch_policies":true/);
  assert.match(config, /repos\/\$R\/environments\/<env>\/deployment-branch-policies --jq/);
  assert.ok(config.includes('["branch:main"]'));
  const deploy = section(moduleDoc, "## 4. GitHub configuration");
  for (const expected of ['["branch:main","tag:v*"]', '["tag:v*"]', "with a beta, `admin` or `turnstile`", "with none of them"]) assert.ok(deploy.includes(expected), expected);
});

test("the repository-level fallback is conditional on the check failing", () => {
  const config = section(baseDoc, "## 4. GitHub configuration");
  assert.match(config, /Fallback, only if a create or a verification above fails/);
  assert.match(config, /state\.mjs skip <dir> github:cloudflare-tofu-base:1/);
  assert.match(section(moduleDoc, "## 4. GitHub configuration"), /fallback in\s+`github:cloudflare-tofu-base:1`/);
  assert.match(config, /docs\/threat-model\.md/);
  assert.match(config, /offer the plan upgrade/);
  assert.doesNotMatch(section(baseDoc, "## 3. Files"), /threat-model/);
  assert.doesNotMatch(baseDoc, /Free private repository only/);
  assert.doesNotMatch(baseDoc, /environments aren't available, so/);
});

test("secret commands use --env normally and repository level only on the fallback", () => {
  const manual = section(moduleDoc, "## 5. Manual steps");
  const baseManual = section(baseDoc, "## 5. Manual steps");
  assert.match(baseManual, /CLOUDFLARE_INFRA_APPLY_TOKEN --repo \$R --env infra/);
  assert.match(baseManual, /TF_STATE_ACCESS_KEY_ID --repo \$R --env infra/);
  assert.match(baseManual, /recorded\s+an\s+environment as skipped/);
  assert.doesNotMatch(baseManual, /On a free private repo/);
  assert.doesNotMatch(manual, /secret set(?! (?:TURNSTILE_SECRET_KEY|OWNER_EMAIL) --env production --repo \$R)/);
});

test("the bootstrap skill checks environments on a free private repo rather than assuming", () => {
  const plan = skillDoc.slice(skillDoc.indexOf("**`plan-confirmed`**"), skillDoc.indexOf("**`scaffold`**"));
  assert.doesNotMatch(plan, /environment secrets aren't available/);
  assert.match(plan, /checks\s+rather than assumes/);
  assert.match(plan, /only if that check fails/);
});

const coreDoc = readFileSync(new URL("../skills/bootstrap/modules/core/MODULE.md", import.meta.url), "utf8");

test("no doc reads the plan from the API outside the interview", () => {
  for (const doc of [skillDoc, moduleDoc, coreDoc]) {
    assert.doesNotMatch(doc, /gh api user --jq \.plan\.name/);
  }
  assert.equal(skillDoc.match(/gh api user --jq/g).length, 3);
});

test("the interview asks for the plan only when the token can't read it, for private repos", () => {
  const interview = skillDoc.slice(skillDoc.indexOf("**`interview`**"), skillDoc.indexOf("**`tools`**"));
  assert.match(interview, /gh api user --jq '\.plan\.name \/\/ empty'/);
  assert.match(interview, /`github_plan`/);
  assert.match(interview, /can't read the plan/);
  assert.match(interview, /Public repos get\s+these features on every plan/);
});

test("plan-dependent steps use the recorded github_plan", () => {
  const plan = skillDoc.slice(skillDoc.indexOf("**`plan-confirmed`**"), skillDoc.indexOf("**`scaffold`**"));
  assert.match(plan, /recorded `github_plan`/);
  assert.match(plan, /resumed run uses the saved value/);
  assert.match(coreDoc, /recorded `github_plan` is `free`/);
  assert.match(baseDoc, /recorded `github_plan` is `free`/);
});

const tokensIn = dir => JSON.parse(read(dir, ".bootstrap/cloudflare/tokens.json"));
const dashboardLabels = { "Single Redirect": "Dynamic URL Redirects" };
const normalise = names => names.map(name => name.replace(/\s*\(.*\)$/, "").replace(/\bEdit$/, "Write").replace(/^Single Redirect\b/, dashboardLabels["Single Redirect"])).sort();

function readmeTokens(dir, beta) {
  const section = read(dir, "infra/README.md").split("### Cloudflare API tokens")[1].split("###")[0];
  return section.split("\n").filter(line => /^\| (Preview|Deploy|Infra plan|Infra apply) \|/.test(line)).map(line => {
    const [, token, secret, permissions] = line.split("|").map(cell => cell.trim());
    const [name, scope] = secret.match(/^`([A-Z_]+)` \((.*)\)$/).slice(1);
    const env = scope === "repository" ? null : [...scope.matchAll(/`([a-z]+)`/g)].map(m => m[1]).filter(e => beta || e !== "beta");
    const names = permissions.replace(/(Account|Zone): /g, "").split(/[,.]\s*/).map(s => s.trim()).filter(Boolean);
    return { token, secret: name, env, permissions: normalise(names) };
  });
}

for (const [label, dir, beta] of [["with beta", withBeta, true], ["without beta", noBeta, false]]) {
  test(`every rendered token entry matches the README table ${label}`, () => {
    const rendered = tokensIn(dir).map(({ token, secret, env, permissions }) => ({ token, secret, env, permissions: normalise(permissions) }));
    assert.deepEqual(rendered, readmeTokens(dir, beta));
  });
}

test("the deploy token's environments follow the beta answer", () => {
  assert.deepEqual(tokensIn(withBeta).find(t => t.token === "Deploy").env, ["production", "beta"]);
  assert.deepEqual(tokensIn(noBeta).find(t => t.token === "Deploy").env, ["production"]);
});

test("the README lists the infra plan token's permissions explicitly", () => {
  const plan = readmeTokens(withBeta, true).find(t => t.token === "Infra plan");
  assert.deepEqual(plan.permissions, normalise(["Workers R2 Storage Read", "Transform Rules Read", "DNS Read", "Zone Settings Read", "Zone WAF Read", "Cache Settings Read", "Dynamic URL Redirects Read"]));
  assert.doesNotMatch(read(withBeta, "infra/README.md"), /read-only version of each/);
});

test("the README says Transform Rules covers every zone in the account", () => {
  assert.match(read(withBeta, "infra/README.md"), /Transform Rules.*account-scoped.*every zone in the account/s);
});

test("every DNS record comment fits Cloudflare's 100-character Free plan limit", () => {
  const dir = "skills/bootstrap/modules/cloudflare-opentofu/templates/infra";
  const comments = readdirSync(dir)
    .filter(file => file.endsWith(".tf"))
    .flatMap(file => [...readFileSync(join(dir, file), "utf8").matchAll(/comment\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map(match => ({ file, text: match[1] })));
  assert.ok(comments.length > 0);
  for (const { file, text } of comments) assert.ok(text.length <= 100, `${file}: ${text.length} characters: ${text}`);
});

test("every render's CLAUDE.md has the infrastructure rule", () => {
  for (const dir of [withBeta, noBeta]) {
    assert.match(read(dir, "CLAUDE.md"), /^- Never change anything `infra\/` manages, or add to a zone it manages, through an API, an MCP tool or the dashboard\. Change it in `infra\/` through a PR: \[infra\]\(infra\/README\.md#changing-infrastructure\)\.$/m);
  }
});

test("the infrastructure rule links to a real heading in the infra README", () => {
  const slug = heading => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
  for (const [name, dir] of [["beta", withBeta], ["no beta", noBeta]]) {
    const links = [...read(dir, "CLAUDE.md").matchAll(/\(infra\/README\.md#([^)]+)\)/g)].map(m => m[1]);
    assert.ok(links.length, `${name}: CLAUDE.md links to no infra/README.md heading`);
    const headings = [...read(dir, "infra/README.md").matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1]));
    for (const link of links) assert.ok(headings.includes(link), `${name}: no heading for #${link}`);
  }
});

test("the infra README's change rule points wrangler-owned resources at wrangler and hand-made ones at an import", () => {
  const section = read(withBeta, "infra/README.md").split("## Changing infrastructure")[1].split("\n## ")[0];
  assert.match(section, /`wrangler\.jsonc`/);
  assert.match(section, /`import`\s+block/);
  assert.match(section, /explicit OK/);
  assert.doesNotMatch(section, /state bucket/);
});

test("DNSSEC relies on Cloudflare Registrar and nothing tells anyone to handle the DS record by hand", () => {
  for (const [name, dir] of [["beta", withBeta], ["no beta", noBeta]]) {
    const readme = read(dir, "infra/README.md");
    const outputs = read(dir, "infra/outputs.tf");
    assert.doesNotMatch(readme, /(add|remove) the DS record/i, name);
    assert.doesNotMatch(readme, /at the (domain )?registrar/i, name);
    assert.doesNotMatch(outputs, /at the (domain )?registrar/i, name);
    assert.match(outputs, /Cloudflare Registrar publishes/, name);
    const setup = section(readme, "## Setup");
    assert.match(setup, /Cloudflare Registrar/, name);
    assert.match(setup, /pending/, name);
  }
});

test("teardown disables DNSSEC through infra before it destroys", () => {
  for (const [name, dir] of [["beta", withBeta], ["no beta", noBeta]]) {
    const teardown = section(read(dir, "infra/README.md"), "## Teardown");
    const disable = teardown.search(/`"disabled"`/);
    const destroy = teardown.indexOf("tofu destroy");
    assert.ok(disable >= 0, `${name}: no DNSSEC disable step`);
    assert.ok(destroy >= 0, `${name}: no destroy step`);
    assert.ok(disable < destroy, name);
    assert.match(teardown, /1\.5 times the DS record's TTL/, name);
  }
});

test("the DNSSEC manual step only verifies, because Cloudflare Registrar adds the DS record", () => {
  const step = moduleDoc.slice(moduleDoc.indexOf("### cloudflare-opentofu:2 "), moduleDoc.indexOf("### cloudflare-opentofu:3 "));
  assert.match(step, /^### cloudflare-opentofu:2 Confirm DNSSEC$/m);
  assert.match(step, /\*\*Do:\*\* nothing by hand/);
  assert.match(step, /dig \+short DS <zone_name>/);
  assert.match(step, /pending/);
  assert.doesNotMatch(step, /registrar's DNSSEC/);
  assert.doesNotMatch(section(moduleDoc, "## 2. Interview questions"), /registrar/i);
});

const block = (text, header) => {
  const start = text.indexOf(header);
  assert.ok(start >= 0, header);
  const next = text.indexOf("\nresource ", start + header.length);
  return text.slice(start, next < 0 ? undefined : next);
};

for (const [label, dir] of [["with beta", withBeta], ["without beta", noBeta]]) {
  test(`www is a proxied CNAME to the apex ${label}`, () => {
    const record = block(read(dir, "infra/dns.tf"), 'resource "cloudflare_dns_record" "app_www"');
    assert.match(record, /name\s*=\s*"www\.\$\{var\.app_zone_name\}"/);
    assert.match(record, /type\s*=\s*"CNAME"/);
    assert.match(record, /content\s*=\s*var\.app_zone_name/);
    assert.match(record, /proxied\s*=\s*true/);
    assert.match(record, /prevent_destroy = true/);
  });

  test(`www redirects to the apex over https with a 301, keeping the path and query ${label}`, () => {
    const rules = block(read(dir, "infra/redirects.tf"), 'resource "cloudflare_ruleset" "app_redirects"');
    assert.match(rules, /phase\s*=\s*"http_request_dynamic_redirect"/);
    assert.match(rules, /action\s*=\s*"redirect"/);
    assert.match(rules, /http\.host eq \\"www\.\$\{var\.app_zone_name\}\\"/);
    assert.match(rules, /status_code\s*=\s*301/);
    assert.match(rules, /concat\(\\"https:\/\/\$\{var\.app_zone_name\}\\", http\.request\.uri\.path\)/);
    assert.match(rules, /preserve_query_string\s*=\s*true/);
  });

  test(`the infra tokens can read and write dynamic redirects ${label}`, () => {
    const tokens = tokensIn(dir);
    assert.ok(tokens.find(t => t.token === "Infra plan").permissions.includes("Dynamic URL Redirects Read"));
    assert.ok(tokens.find(t => t.token === "Infra apply").permissions.includes("Dynamic URL Redirects Write"));
    const table = read(dir, "infra/README.md");
    assert.match(table, /Zone:[^\n|]*Single Redirect Read/);
    assert.match(table, /Zone:[^\n|]*Single Redirect Edit/);
  });
}

test("the module warns about an existing www record and the README lists the redirect rule", () => {
  assert.match(section(moduleDoc, "## 2. Interview questions"), /If the apex, `www\.`\s+or `beta\.` already\s+has a record/);
  assert.match(read(withBeta, "infra/README.md"), /the `www` redirect/);
  assert.match(section(moduleDoc, "## 2. Interview questions"), /already has Redirect Rules/);
  assert.match(read(withBeta, "infra/dns.tf"), /comment = "Proxied so the www redirect rule answers; requests never reach an origin\."/);
});

test("the bootstrap skill documents adopting a module in an existing repository", () => {
  const adopting = section(skillDoc, "## Adopting a module in an existing repository");
  assert.match(adopting, /state\.mjs save-answers <dir> <file> <modules>/);
  assert.match(adopting, /render\.mjs --modules <modules> \\\n\s+--answers <dir>\/\.bootstrap\/answers\.json --dest <dir> --bootstrap-only/);
  assert.match(adopting, /nothing outside `\.bootstrap\/`/);
});

test("the docs say tokens are scoped to the project's own Workers, which the bootstrap creates as stubs, and how to reissue", () => {
  const readme = read(withBeta, "infra/README.md");
  assert.match(readme, /Individual Workers Editor \(this project's `preview` Worker only\)/);
  assert.match(readme, /### Reissuing tokens with per-Worker scope/);
  assert.match(readme, /`sample-project-preview`, `sample-project-production` and, with a\nbeta, `sample-project-beta`/);
  assert.doesNotMatch(readme.split("\n").filter(line => line.startsWith("| ")).join("\n"), /Workers Scripts/);
  assert.match(moduleDoc, /The bootstrap creates empty Workers before the first deploy/);
  assert.match(baseDoc, /"Individual Workers Editor"\s+permission\s+and\s+`"workers": \[\.\.\.\]`/);
  assert.match(baseDoc, /"Workers Admin"/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const extra = { zone_name: "example.test", admin: false, turnstile: false };
const withD1 = {
  "d1 with a beta": { dir: renderReal(["cloudflare-opentofu"], { ...extra, beta: true, d1: true }), beta: true },
  "d1 without a beta": { dir: renderReal(["cloudflare-opentofu"], { ...extra, beta: false, d1: true }), beta: false },
  "d1 with admin and turnstile": { dir: renderReal(["cloudflare-opentofu"], { ...extra, beta: true, admin: true, admin_subdomain: "admin", turnstile: true, d1: true }), beta: true },
};
const without = {
  "no d1 with a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: true, d1: false }),
  "no d1 without a beta": renderReal(["cloudflare-opentofu"], { ...extra, beta: false, d1: false }),
  "d1 unanswered": renderReal(["cloudflare-opentofu"], { ...extra, beta: false }),
};
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
const BINDING = { binding: "DB", migrations_dir: "migrations", database_id: "" };
const PERMISSIONS = { Preview: "D1 Write", Deploy: "D1 Write", "Infra plan": "D1 Read", "Infra apply": "D1 Write" };

function workflow(dir, path) {
  const script = "import sys, yaml, json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))";
  const result = spawnSync("python3", ["-I", "-c", script, join(dir, ".github/workflows", path)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const stepNames = job => job.steps.map(step => step.name ?? step.uses ?? step.run);
const stepNamed = (job, name) => job.steps.find(step => step.name === name);

for (const [name, { dir, beta }] of Object.entries(withD1)) {
  test(`${name}: the database is declared with a protected lifecycle and an output`, () => {
    const tf = read(dir, "infra/d1.tf");
    assert.match(tf, /resource "cloudflare_d1_database" "app" \{/);
    assert.match(tf, /account_id\s+= var\.cloudflare_account_id/);
    assert.match(tf, /name\s+= "sample-project"/);
    assert.match(tf, /primary_location_hint = "weur"/);
    assert.match(tf, /read_replication = \{\n\s+mode = "disabled"\n\s+\}/);
    assert.match(tf, /lifecycle \{\n\s+prevent_destroy = true\n\s+\}/);
    assert.match(tf, /output "d1_database_id" \{[^}]*cloudflare_d1_database\.app\.id/);
  });

  test(`${name}: DB is bound with migrations in the top level and every environment, and Previews use their own database`, () => {
    const config = jsonc(read(dir, "wrangler.jsonc"));
    assert.deepEqual(config.d1_databases, [{ ...BINDING, database_name: "sample-project" }]);
    const environments = ["production", "preview", "e2e", ...(beta ? ["beta"] : [])];
    assert.deepEqual(Object.keys(config.env).sort(), environments.sort());
    for (const [envName, env] of Object.entries(config.env)) {
      const preview = envName === "preview";
      assert.deepEqual(env.d1_databases, [{ ...BINDING, database_name: preview ? "sample-project-preview" : "sample-project" }], envName);
    }
    assert.deepEqual(config.env.preview.previews.d1_databases, config.env.preview.d1_databases);
  });

  test(`${name}: an empty migrations directory ships and no migration does`, () => {
    const rendered = [...files(dir)];
    assert.ok(rendered.includes("migrations/.gitkeep"));
    assert.deepEqual(rendered.filter(file => file.startsWith("migrations/") && file.endsWith(".sql")), []);
  });

  test(`${name}: the tokens gain D1 Read on Infra plan and D1 Write on the others, in the README too`, () => {
    const tokens = JSON.parse(read(dir, ".bootstrap/cloudflare/tokens.json"));
    for (const [token, permission] of Object.entries(PERMISSIONS)) {
      const permissions = tokens.find(item => item.token === token).permissions;
      assert.equal(permissions.filter(item => /^D1 /.test(item)).join(), permission, token);
    }
    const readme = read(dir, "infra/README.md");
    const row = token => readme.split("\n").find(line => line.startsWith(`| ${token} |`));
    assert.match(row("Preview"), /D1 Edit/);
    assert.match(row("Deploy"), /D1 Edit/);
    assert.match(row("Infra apply"), /D1 Edit/);
    assert.match(row("Infra plan"), /D1 Read/);
    assert.doesNotMatch(row("Infra plan"), /D1 Edit/);
  });

  test(`${name}: the README documents setup, migrations, restore, previews and the account-wide permissions`, () => {
    const readme = read(dir, "infra/README.md");
    const section = readme.slice(readme.indexOf("## D1 database"), readme.indexOf("## Disaster recovery"));
    for (const expected of ["d1_database_id", "wrangler d1 migrations create DB", "time-travel restore sample-project --bookmark=", "expand and contract", "sample-project-pr-<number>", "account-wide", "doesn't migrate"]) {
      assert.ok(section.includes(expected), expected);
    }
  });

  test(`${name}: local e2e and preview apply migrations before wrangler dev`, () => {
    const { scripts } = JSON.parse(read(dir, "package.json"));
    assert.equal(scripts["e2e:server"], "pnpm build && wrangler d1 migrations apply DB --local --env e2e && wrangler dev --env e2e --port 4173");
    assert.equal(scripts.preview, "pnpm build && wrangler d1 migrations apply DB --local --env e2e && wrangler dev --env e2e");
    assert.equal(scripts.dev, "pnpm build && wrangler dev --port 5173");
  });

  test(`${name}: the tag deploy records a restore point then migrates, before it deploys`, () => {
    const job = workflow(dir, "deploy.yml").jobs.deploy;
    const env = beta ? "beta" : "production";
    const names = stepNames(job);
    const record = names.indexOf("Record a D1 restore point");
    const migrate = names.indexOf("Apply D1 migrations");
    assert.ok(record > -1 && record < migrate && migrate < names.indexOf(`Deploy to ${env}`), names.join(" | "));
    const recordStep = stepNamed(job, "Record a D1 restore point");
    assert.match(recordStep.run, new RegExp(`wrangler d1 time-travel info sample-project --env ${env} --json`));
    assert.match(recordStep.run, /GITHUB_STEP_SUMMARY/);
    assert.match(recordStep.run, /time-travel restore sample-project --bookmark=\$BOOKMARK/);
    assert.equal(stepNamed(job, "Apply D1 migrations").run, `pnpm exec wrangler d1 migrations apply sample-project --env ${env} --remote`);
    for (const step of [recordStep, stepNamed(job, "Apply D1 migrations")]) {
      assert.equal(step.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_DEPLOY_TOKEN }}");
      assert.equal(step.env.CLOUDFLARE_ACCOUNT_ID, "${{ vars.CLOUDFLARE_ACCOUNT_ID }}");
    }
  });

  test(`${name}: the preview job creates, migrates and uses a per-PR database, and the cleanup deletes it`, () => {
    const wf = workflow(dir, "preview.yml");
    const names = stepNames(wf.jobs.preview);
    assert.ok(names.indexOf("Create and migrate the Preview database") > -1);
    assert.ok(names.indexOf("Create and migrate the Preview database") < names.indexOf("Upload the Preview"));
    const create = stepNamed(wf.jobs.preview, "Create and migrate the Preview database").run;
    assert.match(create, /wrangler d1 create "\$DB_NAME" --location weur/);
    assert.match(create, /wrangler d1 migrations apply "\$DB_NAME" -c \.wrangler-preview\.jsonc --env preview --remote/);
    assert.match(stepNamed(wf.jobs.preview, "Upload the Preview").run, /wrangler preview -c \.wrangler-preview\.jsonc --env preview --name/);
    assert.equal(stepNamed(wf.jobs.preview, "Create and migrate the Preview database").env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}");
    const cleanup = stepNames(wf.jobs.cleanup);
    assert.ok(cleanup.indexOf("Delete the Preview") > -1 && cleanup.indexOf("Delete the Preview database") > cleanup.indexOf("Delete the Preview"));
    assert.match(stepNamed(wf.jobs.cleanup, "Delete the Preview database").run, /wrangler d1 delete "\$DB_NAME" --skip-confirmation/);
  });

  test(`${name}: promote doesn't migrate`, () => {
    if (!beta) return assert.ok(!existsSync(join(dir, ".github/workflows/promote.yml")));
    assert.doesNotMatch(read(dir, ".github/workflows/promote.yml"), /d1/);
  });
}

for (const [name, dir] of Object.entries(without)) {
  test(`${name}: nothing about D1 is rendered`, () => {
    const rendered = [...files(dir)];
    assert.ok(!rendered.includes("infra/d1.tf"));
    assert.ok(!rendered.some(file => file.startsWith("migrations/")));
    for (const file of rendered) {
      if (/^(\.bootstrap\/cloudflare\/tokens\.json|wrangler\.jsonc|package\.json|infra\/README\.md|\.github\/workflows\/(deploy|preview)\.yml)$/.test(file)) {
        assert.doesNotMatch(read(dir, file), /\bd1\b|\bD1\b|\.wrangler-preview\.jsonc/, file);
      }
    }
    for (const file of ["wrangler.jsonc", ".bootstrap/cloudflare/tokens.json", "package.json"]) assert.ok(JSON.parse(read(dir, file).replace(/^\s*\/\/.*$/gm, "")), file);
    assert.equal(workflow(dir, "preview.yml").jobs.cleanup.steps.length, 3);
  });
}

function fakeWrangler(scratch) {
  mkdirSync(join(scratch, "bin"), { recursive: true });
  const script = [
    'echo "$*" >> "$CALLS"',
    'case "$*" in',
    '  "exec wrangler d1 list --json") echo "a banner line"; cat "$LIST";;',
    '  "exec wrangler d1 create "*) echo "[{\\"name\\":\\"$5\\",\\"uuid\\":\\"new-uuid\\"}]" > "$LIST";;',
    "esac",
    "",
  ].join("\n");
  writeFileSync(join(scratch, "bin", "pnpm"), script, { mode: 0o755 });
}

function runStep(dir, wfName, job, stepName, { list, pr = "7" }) {
  const scratch = mkdtempSync(join(tmpdir(), "d1-step-"));
  fakeWrangler(scratch);
  copyFileSync(join(dir, "wrangler.jsonc"), join(scratch, "wrangler.jsonc"));
  const listFile = join(scratch, "list.json");
  writeFileSync(listFile, JSON.stringify(list));
  const calls = join(scratch, "calls");
  writeFileSync(calls, "");
  const script = stepNamed(workflow(dir, wfName).jobs[job], stepName).run;
  const result = spawnSync("bash", ["-c", script], {
    cwd: scratch,
    env: { ...process.env, PATH: `${join(scratch, "bin")}:${process.env.PATH}`, PR_NUMBER: pr, LIST: listFile, CALLS: calls },
    encoding: "utf8",
  });
  return { result, scratch, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
}

const STEP = "Create and migrate the Preview database";
const dir = withD1["d1 with a beta"].dir;

test("the preview step creates a missing database, migrates it, and writes a temporary config that points both bindings at it", () => {
  const { result, scratch, calls } = runStep(dir, "preview.yml", "preview", STEP, { list: [{ name: "other", uuid: "x" }] });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.includes("exec wrangler d1 create sample-project-pr-7 --location weur"), calls.join("\n"));
  assert.equal(calls.at(-1), "exec wrangler d1 migrations apply sample-project-pr-7 -c .wrangler-preview.jsonc --env preview --remote");
  const config = JSON.parse(readFileSync(join(scratch, ".wrangler-preview.jsonc"), "utf8"));
  const expected = [{ ...BINDING, database_name: "sample-project-pr-7", database_id: "new-uuid" }];
  assert.deepEqual(config.env.preview.d1_databases, expected);
  assert.deepEqual(config.env.preview.previews.d1_databases, expected);
  assert.deepEqual(config.env.production.d1_databases, jsonc(read(dir, "wrangler.jsonc")).env.production.d1_databases);
  assert.equal(config.main, "src/worker.js");
});

test("the preview step is idempotent: an existing database is reused, not created again", () => {
  const { result, scratch, calls } = runStep(dir, "preview.yml", "preview", STEP, { list: [{ name: "sample-project-pr-7", uuid: "existing-uuid" }] });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!calls.some(call => call.includes("d1 create")), calls.join("\n"));
  assert.equal(JSON.parse(readFileSync(join(scratch, ".wrangler-preview.jsonc"), "utf8")).env.preview.d1_databases[0].database_id, "existing-uuid");
});

test("the cleanup step deletes the PR's database, and does nothing when it is already gone", () => {
  const present = runStep(dir, "preview.yml", "cleanup", "Delete the Preview database", { list: [{ name: "sample-project-pr-7", uuid: "u" }, { name: "sample-project-pr-70", uuid: "v" }] });
  assert.equal(present.result.status, 0, present.result.stderr);
  assert.deepEqual(present.calls.filter(call => call.includes("delete")), ["exec wrangler d1 delete sample-project-pr-7 --skip-confirmation"]);
  const gone = runStep(dir, "preview.yml", "cleanup", "Delete the Preview database", { list: [{ name: "sample-project-pr-70", uuid: "v" }] });
  assert.equal(gone.result.status, 0, gone.result.stderr);
  assert.ok(!gone.calls.some(call => call.includes("delete")));
});

test("the restore point step writes the bookmark and the restore command to the job summary", () => {
  const scratch = mkdtempSync(join(tmpdir(), "d1-step-"));
  mkdirSync(join(scratch, "bin"));
  writeFileSync(join(scratch, "bin", "pnpm"), 'echo "$*" >> "$CALLS"\necho "a banner"\necho \'{"bookmark":"00000085-0000024c"}\'\n', { mode: 0o755 });
  const summary = join(scratch, "summary.md");
  const calls = join(scratch, "calls");
  const script = stepNamed(workflow(withD1["d1 with a beta"].dir, "deploy.yml").jobs.deploy, "Record a D1 restore point").run;
  const result = spawnSync("bash", ["-c", script], { env: { ...process.env, PATH: `${join(scratch, "bin")}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, CALLS: calls }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(summary, "utf8");
  assert.match(text, /`00000085-0000024c`/);
  assert.match(text, /wrangler d1 time-travel restore sample-project --bookmark=00000085-0000024c/);
});

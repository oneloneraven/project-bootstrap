import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveModules } from "../skills/bootstrap/scripts/render.mjs";
import { files, realModulesDir, renderReal } from "./helpers.mjs";

const dest = renderReal(["cloudflare-identity"]);
const read = path => readFileSync(join(dest, path), "utf8");
const block = (text, header) => {
  const start = text.indexOf(header);
  assert.ok(start >= 0, header);
  const next = text.indexOf("\nresource ", start + header.length);
  return text.slice(start, next < 0 ? undefined : next);
};

test("a render has the identity stack, its workflows, token definitions and README, and no app files", () => {
  const rendered = [...files(dest)];
  for (const file of [
    "infra/main.tf", "infra/variables.tf", "infra/identity.tf", "infra/apps.tf", "infra/widgets.tf", "infra/outputs.tf",
    "infra/terraform.tfvars.json", "infra/README.md", ".bootstrap/cloudflare/tokens.json", ".github/workflows/infra.yml",
    ".github/workflows/rotate-turnstile-secret.yml", ".github/workflows/bootstrap-state.yml", "scripts/bootstrap-state.mjs",
  ]) assert.ok(rendered.includes(file), file);
  for (const file of ["package.json", "wrangler.jsonc", "src/worker.js", "pnpm-workspace.yaml", "infra/dns.tf"]) assert.ok(!rendered.includes(file), file);
  assert.deepEqual(resolveModules(["cloudflare-identity"], realModulesDir).map(m => m.name), ["core", "cloudflare-tofu-base", "cloudflare-identity"]);
});

test("it can't be combined with cloudflare-opentofu", () => {
  assert.throws(() => resolveModules(["cloudflare-identity", "cloudflare-opentofu"], realModulesDir), /Conflicting modules/);
});

test("the backend and shared sections come from the base, with the stack's own slug", () => {
  assert.match(read("infra/main.tf"), /backend "s3" \{\n\s+bucket\s+= "sample-project-tfstate"/);
  assert.match(read("infra/README.md"), /## Deleting resources[\s\S]*### R2 state credentials[\s\S]*### OpenTofu version/);
  assert.doesNotMatch(read("infra/README.md"), /\{\{/);
});

test("every application gets the standard settings and none can be set per project", () => {
  const app = block(read("infra/apps.tf"), 'resource "cloudflare_zero_trust_access_application" "admin"');
  assert.match(app, /for_each\s*=\s*var\.apps/);
  assert.match(app, /type\s*=\s*"self_hosted"/);
  assert.match(app, /session_duration\s*=\s*"8h"/);
  assert.match(app, /allowed_idps\s*=\s*\[cloudflare_zero_trust_access_identity_provider\.login\.id\]/);
  assert.match(app, /auto_redirect_to_identity\s*=\s*true/);
  assert.match(app, /enable_binding_cookie\s*=\s*true/);
  assert.match(app, /http_only_cookie_attribute\s*=\s*true/);
  assert.match(app, /same_site_cookie_attribute\s*=\s*"lax"/);
  assert.match(app, /policies\s*=\s*\[\{\s*id\s*=\s*cloudflare_zero_trust_access_policy\.owner\.id\s*precedence\s*=\s*1\s*\}\]/);
  const settings = ["session_duration", "allowed_idps", "auto_redirect_to_identity", "enable_binding_cookie", "http_only_cookie_attribute", "same_site_cookie_attribute", "policies", "type"];
  for (const setting of settings) assert.doesNotMatch(app, new RegExp(`${setting}\\s*=\\s*each\\.`), setting);
  const variables = read("infra/variables.tf");
  const apps = variables.slice(variables.indexOf('variable "apps"'), variables.indexOf('variable "widgets"'));
  assert.match(apps, /map\(object\(\{\s*name\s*=\s*string\s*domain\s*=\s*string\s*\}\)\)/);
  assert.match(apps, /default\s*=\s*\{\}/);
});

test("the committed project lists start empty and are not ignored by git", () => {
  assert.deepEqual(JSON.parse(read("infra/terraform.tfvars.json")), { apps: {}, widgets: {} });
  assert.ok(!read(".gitignore").split("\n").some(line => line === "*.tfvars.json" || line === "terraform.tfvars.json"));
});

test("the login method, the organisation and the owner policy are set as designed", () => {
  const identity = read("infra/identity.tf");
  assert.match(identity, /import \{\n\s+to = cloudflare_zero_trust_organization\.this\n\s+id = var\.cloudflare_account_id\n\}/);
  assert.match(identity, /import \{\n\s+to = cloudflare_zero_trust_access_identity_provider\.login\n\s+id = "accounts\/\$\{var\.cloudflare_account_id\}\/\$\{var\.login_method_id\}"\n\}/);
  const orgBlock = block(identity, 'resource "cloudflare_zero_trust_organization" "this"');
  const org = orgBlock.slice(0, orgBlock.indexOf("\n}\n"));
  assert.match(org, /is_ui_read_only\s*=\s*true/);
  assert.match(org, /ui_read_only_toggle_reason\s*=\s*"[^"]+"/);
  assert.match(org, /ignore_changes/);
  const settingsSet = [...org.matchAll(/^\s{2}(\w+)\s*=/gm)].map(m => m[1]);
  assert.deepEqual(settingsSet, ["account_id", "is_ui_read_only", "ui_read_only_toggle_reason"]);
  const provider = block(identity, 'resource "cloudflare_zero_trust_access_identity_provider" "login"');
  assert.match(provider, /type\s*=\s*"cloudflare"/);
  assert.match(provider, /restrict_to_account_members\s*=\s*true/);
  const policy = block(identity, 'resource "cloudflare_zero_trust_access_policy" "owner"');
  assert.match(policy, /decision\s*=\s*"allow"/);
  assert.match(policy, /email\s*=\s*var\.owner_email/);
  assert.match(read("infra/variables.tf"), /variable "owner_email" \{[^}]*sensitive\s*=\s*true/);
});

test("widgets come from a map, default to managed mode and can't be destroyed by accident", () => {
  const widget = block(read("infra/widgets.tf"), 'resource "cloudflare_turnstile_widget" "site"');
  assert.match(widget, /for_each\s*=\s*var\.widgets/);
  assert.match(widget, /prevent_destroy\s*=\s*true/);
  assert.match(widget, /domains\s*=\s*sort\(each\.value\.domains\)/);
  assert.match(read("infra/variables.tf"), /mode\s*=\s*optional\(string, "managed"\)/);
});

test("the outputs give the audience, team domain and sitekeys, and no secret", () => {
  const outputs = read("infra/outputs.tf");
  assert.deepEqual([...outputs.matchAll(/^output "(\w+)"/gm)].map(m => m[1]), ["team_domain", "app_aud", "widget_sitekey"]);
  assert.doesNotMatch(outputs, /secret|sensitive/i);
  assert.match(outputs, /cloudflare_zero_trust_organization\.this\.auth_domain/);
});

test("the rotation workflow runs only by hand, on main, in the infra environment", () => {
  const workflow = read(".github/workflows/rotate-turnstile-secret.yml");
  const triggers = workflow.slice(workflow.indexOf("\non:\n") + 1, workflow.indexOf("\npermissions:"));
  assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map(m => m[1]), ["workflow_dispatch"]);
  assert.match(triggers, /sitekey:\n\s+description: .*\n\s+required: true\n\s+type: string/);
  assert.match(triggers, /invalidate_immediately:\n\s+description: .*\n\s+type: boolean\n\s+default: false/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: infra/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_INFRA_APPLY_TOKEN \}\}/);
  assert.match(workflow, /rotate_secret/);
});

test("the rotation workflow validates the sitekey, passes inputs through env and never writes the secret anywhere", () => {
  const workflow = read(".github/workflows/rotate-turnstile-secret.yml");
  const script = workflow.slice(workflow.indexOf("run: |"));
  assert.match(workflow, /SITEKEY: \$\{\{ inputs\.sitekey \}\}/);
  assert.match(workflow, /INVALIDATE: \$\{\{ inputs\.invalidate_immediately \}\}/);
  assert.doesNotMatch(script, /\$\{\{/);
  assert.match(script, /\[\[ "\$SITEKEY" =~ \^0x\[0-9A-Za-z_-\]\{6,40\}\$ \]\]/);
  assert.match(script, /jq -e '\.success == true' > \/dev\/null/);
  assert.match(script, /curl -sSf/);
  for (const forbidden of [/GITHUB_OUTPUT/, /GITHUB_STEP_SUMMARY/, /::add-mask::/, /set -x/, /-o /, /--output/, /tee /, />\s*"?\$/, /echo[^\n]*\$\{?(response|body|secret)/i]) {
    assert.doesNotMatch(script.replace("> /dev/null", ""), forbidden, String(forbidden));
  }
  assert.doesNotMatch(workflow, /actions\/checkout/);
});

test("the token definitions are the plan and apply tokens, account-scoped, with the proven permission names", () => {
  const tokens = JSON.parse(read(".bootstrap/cloudflare/tokens.json"));
  assert.deepEqual(tokens.map(t => t.token), ["Infra plan", "Infra apply"]);
  assert.ok(tokens.every(t => !t.zone));
  assert.deepEqual(tokens[0].permissions, ["Workers R2 Storage Read", "Access: Organizations, Identity Providers, and Groups Read", "Access: Apps Read", "Access: Policies Read", "Turnstile Sites Read"]);
  assert.deepEqual(tokens[1].permissions, ["Workers R2 Storage Write", "Access: Organizations, Identity Providers, and Groups Write", "Access: Apps Write", "Access: Policies Write", "Turnstile Sites Write"]);
  assert.deepEqual(tokens.map(t => [t.secret, t.env]), [["CLOUDFLARE_INFRA_PLAN_TOKEN", null], ["CLOUDFLARE_INFRA_APPLY_TOKEN", ["infra"]]]);
  const readme = read("infra/README.md");
  for (const row of ["| Infra plan | `CLOUDFLARE_INFRA_PLAN_TOKEN` (repository) |", "| Infra apply | `CLOUDFLARE_INFRA_APPLY_TOKEN` (environment `infra`) |"]) assert.ok(readme.includes(row), row);
  for (const name of ["Access: Organizations, Identity Providers, and Groups Read", "Access: Apps Read", "Access: Policies Read", "Turnstile Sites Read", "Access: Organizations, Identity Providers, and Groups Edit", "Access: Apps Edit", "Access: Policies Edit", "Turnstile Sites Edit"]) assert.ok(readme.includes(name), name);
  assert.match(readme, /organisations permission is the one name not yet proven/);
});

test("the README covers adding a project, a widget, rotation, importing and the account guidance", () => {
  const readme = read("infra/README.md");
  for (const heading of ["## Adding a project's admin section", "## Adding a widget", "## Rotating a widget's secret", "## Importing existing applications, policies and widgets", "## Account guidance"]) assert.ok(readme.includes(heading), heading);
  assert.match(readme, /passkey or security-key two-factor only, with no\nauthenticator-app or email fallback/);
  assert.match(readme, /backup codes somewhere other\nthan the passkey's own store/);
  assert.match(readme, /`app_aud\["example"\]` and `team_domain`/);
});

test("the CLAUDE.md index carries the identity stack's rules and the register has its row", () => {
  assert.match(read("CLAUDE.md"), /^- Never change anything `infra\/` manages through an API, an MCP tool or the dashboard\. Change it in `infra\/` through a PR: \[infra\]\(infra\/README\.md#changing-infrastructure\)\.$/m);
  assert.match(read("docs/dependency-register.md"), /\| Cloudflare Zero Trust Access and Turnstile \|/);
  assert.match(read("docs/dependency-register.md"), /\| OpenTofu \|/);
});

test("no file in the render names a project or a private detail", () => {
  for (const file of files(dest)) assert.doesNotMatch(read(file), /climbing|deaftly|engage|coraxia/i, file);
});

test("the stack module exists", () => {
  assert.ok(existsSync(join(realModulesDir, "cloudflare-identity", "MODULE.md")));
});

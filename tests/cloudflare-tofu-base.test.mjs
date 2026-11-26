import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderReal } from "./helpers.mjs";

const renders = { beta: renderReal(["cloudflare-opentofu"], { zone_name: "example.test", beta: true }), nobeta: renderReal(["cloudflare-opentofu"], { zone_name: "example.test", beta: false }), identity: renderReal(["cloudflare-identity"]) };
const stacks = { "cloudflare-opentofu": "github/workflows/infra.yml", "cloudflare-identity": "github/workflows/infra.yml" };

test("the base's manual steps run in the order the work needs: tokens, then the state bucket, then R2 credentials", () => {
  const doc = readFileSync(new URL("../skills/bootstrap/modules/cloudflare-tofu-base/MODULE.md", import.meta.url), "utf8");
  const headings = [...doc.matchAll(/^### (cloudflare-tofu-base:\d+) (.+)$/gm)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(headings, [
    "cloudflare-tofu-base:1 Create the Cloudflare API tokens",
    "cloudflare-tofu-base:2 Create the state bucket",
    "cloudflare-tofu-base:3 Create the R2 state credentials",
  ]);
});

const baseTemplates = new URL("../skills/bootstrap/modules/cloudflare-tofu-base/templates/", import.meta.url);
const stackTemplates = new URL("../skills/bootstrap/modules/cloudflare-opentofu/templates/", import.meta.url);
const skeleton = readFileSync(new URL("infra.skeleton.yml", baseTemplates), "utf8");
const withoutTfVars = text => text.split("\n").filter(line => !/^\s+TF_VAR_/.test(line)).join("\n");

for (const stack of Object.keys(stacks)) {
  test(`${stack}'s infra.yml equals the base skeleton apart from its TF_VAR_ lines`, () => {
    const stackFile = new URL(`../skills/bootstrap/modules/${stack}/templates/github/workflows/infra.yml`, import.meta.url);
    assert.equal(withoutTfVars(readFileSync(stackFile, "utf8")), withoutTfVars(skeleton));
  });
}

test("the skeleton comparison fails on drift outside the TF_VAR_ lines and ignores changes to them", () => {
  const stack = readFileSync(new URL("github/workflows/infra.yml", stackTemplates), "utf8");
  const drifted = stack.replace("tofu fmt -check -recursive", "tofu fmt -recursive");
  assert.notEqual(withoutTfVars(drifted), withoutTfVars(skeleton));
  const extra = stack.replace("      TF_VAR_cloudflare_account_id", "      TF_VAR_owner: ${{ secrets.OWNER }}\n      TF_VAR_cloudflare_account_id");
  assert.equal(withoutTfVars(extra), withoutTfVars(skeleton));
});

test("the skeleton keeps the delete guard and the version token", () => {
  assert.match(skeleton, /if: \$\{\{ !inputs\.allow_deletes \}\}/);
  assert.match(skeleton, /tofu_version: "@@TOFU_VERSION@@"/);
});

test("a stack's README repeats the shared recovery and teardown steps", () => {
  const flat = text => text.replace(/\s+/g, " ");
  const steps = readFileSync(new URL("readme-shared-steps.md", baseTemplates), "utf8").replace(/\{\{slug\}\}/g, "sample-project").split("\n").filter(Boolean);
  assert.ok(steps.length >= 5);
  for (const [variant, dir] of Object.entries(renders)) {
    const readme = flat(readFileSync(join(dir, ".bootstrap/vault/infra/README.md"), "utf8"));
    for (const step of steps) assert.ok(readme.includes(flat(step)), `${variant}: ${step}`);
  }
});

test("the shared README sections and the backend live only in the base", () => {
  const stackReadme = readFileSync(new URL("infra/README.md", stackTemplates), "utf8");
  for (const heading of ["## Deleting resources", "### R2 state credentials", "### OpenTofu version"]) assert.ok(!stackReadme.includes(heading), heading);
  assert.ok(!readFileSync(new URL("infra/main.tf", stackTemplates), "utf8").includes('backend "s3"'));
  for (const dir of Object.values(renders)) {
    assert.match(readFileSync(join(dir, ".bootstrap/vault/infra/README.md"), "utf8"), /## Deleting resources[\s\S]*### R2 state credentials[\s\S]*### OpenTofu version/);
    assert.match(readFileSync(join(dir, "infra/main.tf"), "utf8"), /backend "s3" \{\n    bucket\s+= "sample-project-tfstate"/);
  }
});

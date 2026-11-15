# Module: cloudflare-tofu-base

The OpenTofu plumbing any Cloudflare stack needs: the R2 state bucket and
backend, the OpenTofu version pin, the `infra` environment, and the README
sections for deleting resources, R2 credentials and the OpenTofu version.
Stack modules such as `cloudflare-opentofu` depend on it and add their own
resources, tokens and `infra.yml`.

## 1. Depends on

Nothing.

## 2. Interview questions

None. The slug is limited to 40 characters: the state bucket is named from it.

### Plan warnings

- **Free private repository** (the recorded `github_plan` is `free`):
  GitHub's documentation says environments need a paid plan for private
  repositories, but the bootstrap checks rather than assumes. It creates the
  environments and verifies their branch and tag policies took effect. Say
  that the module falls back only if the check fails: then the infra apply
  and state read-write credentials become repository secrets, which any
  workflow on any branch can read, so a pull request that edits a workflow
  could reach the live zone and the state. In that case the alternative is
  upgrading the plan (GitHub Pro or Team); offer both and let the user
  choose.

## 3. Files

- `scripts/bootstrap-state.mjs` and the workflow `bootstrap-state.yml`,
  which create the state bucket.
- `templates/infra.skeleton.yml`: the shape every stack's `infra.yml`
  follows. It isn't rendered; a test checks each stack's `infra.yml` matches
  it apart from the `TF_VAR_*` lines.
- Fragments for stack modules to place with `{{fragment_<name>}}`: the
  `terraform` block with the R2 backend (`tofu_terraform_block`) and the
  README sections `deleting_resources`, `r2_state_credentials` and
  `opentofu_version`.
- `templates/readme-shared-steps.md`: the disaster recovery and teardown
  steps every stack's README repeats, in order; a test checks each stack's
  README contains them. It isn't rendered.

The templates hold no OpenTofu version. `infra.yml` carries the token
`@@TOFU_VERSION@@` as `setup-opentofu`'s `tofu_version`, which the scaffold
fills in so nothing is stale on the day of the bootstrap. The render test
checks that the template carries the token; step 3 of the scaffold checks
that none is left after it.

**Scaffold:** after rendering the initial stage, and with `<dir>` as the
working directory. "Old enough" means published more than 72 hours ago, and a
release that is a draft or a pre-release is never used.

1. Resolve the OpenTofu version:

   ```bash
   gh api "repos/opentofu/opentofu/releases?per_page=30" --jq '[.[] | select(.prerelease == false and .draft == false and (.published_at | fromdateiso8601) < (now - 259200))][0].tag_name'
   ```

   Strip the leading `v`.
2. Replace the token: `sed -i 's/@@TOFU_VERSION@@/<version>/' .github/workflows/infra.yml`.
3. Check that none survives: `! grep -rn '@@[A-Z0-9_]*@@' .github/workflows`.

`tofu_version` is exact, so Dependabot never bumps it. To upgrade, resolve
the newest release more than 72 hours old as above, change `tofu_version` in
`infra.yml`, and keep the local `tofu` on the same version.

## 4. GitHub configuration

After core's configuration. Steps `github:cloudflare-tofu-base:<n>`.

1. Environments, on every plan, each limited to the refs that may deploy
   from it. Here that is `infra`: the `main` branch only. A stack module
   adds its own, such as a deploy environment, the same way.

   For each: `gh api -X PUT repos/$R/environments/<env> --input -` with
   `{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}`,
   then for each allowed ref
   `gh api -X POST repos/$R/environments/<env>/deployment-branch-policies -f name=<ref> -f type=<branch|tag>`.

   **Verify each one straight after creating it.** Both must pass:
   - `gh api repos/$R/environments/<env> --jq '.deployment_branch_policy'`
     prints `{"custom_branch_policies":true,"protected_branches":false}`,
     not `null`;
   - `gh api repos/$R/environments/<env>/deployment-branch-policies --jq '[.branch_policies[] | "\(.type):\(.name)"] | sort'`
     lists exactly the expected refs: `["branch:main"]` for `infra`.

   If every environment passes, record the step done.

   **Fallback, only if a create or a verification above fails** (typically
   a free private repository, where GitHub's documentation says
   environments aren't available), and for no other reason:
   - record each environment that failed as skipped:
     `node scripts/state.mjs skip <dir> github:cloudflare-tofu-base:1 "environment branch policy not available: <what failed>"`;
   - record the skipped environments for the secrets script:
     `node scripts/state.mjs record <dir> skipped_envs <comma list of skipped environments>`;
   - set the secrets of a skipped environment at repository level (the
     manual steps say how);
   - add a row to `docs/threat-model.md`'s STRIDE table, after the existing
     rows, on the first PR's branch: threat "Any workflow on any branch can
     read the repository-level infra apply and state read-write
     credentials", category Elevation of privilege, mitigation "Environment
     branch policies weren't available on this repository when it was
     bootstrapped; upgrade the plan and move these secrets into the `infra`
     environment", status Accepted;
   - offer the plan upgrade (GitHub Pro or Team) and let the user choose.
2. `gh variable set CLOUDFLARE_ACCOUNT_ID --repo $R --body <account id>`
   (ask the user for it; it isn't confidential).

## 5. Manual steps

Do these after the stack module's token step. `infra/README.md` (rendered
into the project) has the same steps for later rebuilds.

### cloudflare-tofu-base:1 Create the state bucket

**Why:** the state bucket must exist before OpenTofu can run.

**Do:** nothing by hand. Claude runs
`gh workflow run bootstrap-state.yml --repo $R` once core:1 and the
stack's token step are done.

**Verify (Claude runs):** `gh run watch --repo $R --exit-status` on that run.
**Expected:** success, with "Created bucket" or "already exists" in the log.

### cloudflare-tofu-base:2 Create the R2 state credentials

**Why:** the state backend reads and writes state through R2's S3 API.
PR plans get a read-only pair, so PR code can't rewrite state.

**Do:** make a fresh bootstrap token as in the stack's token step (only
Account: Account API Tokens: Edit, expiring today), then run
`node <skill dir>/scripts/secrets.mjs cloudflare-r2 <project dir>` and paste
it at the hidden prompt, with the account id when asked. The script creates
the two bucket-scoped tokens, derives the S3 key pairs, stores them in
Proton Pass, sets the four secrets, and deletes the bootstrap token. The
account id comes from the flag, the stored value or the prompt, as in the
stack's token step (`--account-id` overrides it).

**By hand:** Cloudflare dashboard → R2 → Manage R2 API Tokens. Create two
tokens, both applied to the `<slug>-tfstate` bucket only:
1. Object Read & Write. Then
   `gh secret set TF_STATE_ACCESS_KEY_ID --repo $R --env infra` and
   `gh secret set TF_STATE_SECRET_ACCESS_KEY --repo $R --env infra`.
2. Object Read only. Then
   `gh secret set TF_STATE_READ_ACCESS_KEY_ID --repo $R` and
   `gh secret set TF_STATE_READ_SECRET_ACCESS_KEY --repo $R`.

If `infra` was skipped, set the read-write pair at repository level too.

**Verify (Claude runs):** `gh secret list --repo $R` and
`gh secret list --repo $R --env infra`.
**Expected:** the read-only pair at repository level, the read-write pair in
`infra` (or both at repository level if `infra` was skipped).

## 6. Standards

None of its own.

## 7. Smoke check

Run through a stack module, such as `cloudflare-opentofu`.

# Infrastructure

{{fragment_infra_readme_intro_owned}}{{fragment_infra_readme_intro_shared}}

State lives in the R2 bucket `{{slug}}-tfstate`, never in git.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `infra.yml` | PR touching `infra/` (plan); push to `main` (apply); manual | Format check, validate, plan; refuses any plan that deletes or replaces unless run by hand with `allow_deletes` ([Deleting resources](#deleting-resources)). Skips the repository's first push, before credentials exist |
| `bootstrap-state.yml` | Manual | Creates the state bucket if it's missing; safe to re-run |
| `preview.yml` | PR | Uploads a Preview named `pr-<n>` and comments its URL |
| `deploy.yml` | `v*` tag | Deploys the tag (to beta when the project has one, otherwise production) |
| `promote.yml` | Manual, with a tag | Deploys a released tag to production (beta projects only) |

## Changing infrastructure

{{fragment_infra_readme_changing_owned}}{{fragment_infra_readme_changing_shared}}

- Before writing to Cloudflare through an API, an MCP tool or the dashboard,
  check whether `infra/` declares that resource. If it does, make the change
  there instead. Anything new in a zone `infra/` manages goes into `infra/`
  too, even when OpenTofu would leave it alone, because otherwise the
  repository stops being the record of what's live.
- In an emergency, a change by hand needs the maintainer's explicit OK first.
  Then declare the same resource in `infra/` straight away, with an `import`
  block for anything created by hand, so the next apply adopts it instead of
  failing to create it again.

{{fragment_deleting_resources}}

## Setup

{{fragment_infra_readme_setup_owned}}{{fragment_infra_readme_setup_shared}}

### Cloudflare API tokens

Create each as an account-owned token with a one-year expiry, scoped to this
account and, for zone permissions, to `{{zone_name}}` only.

| Token | GitHub secret | Permissions |
|---|---|---|
| Preview | `CLOUDFLARE_PREVIEW_TOKEN` (repository) | Account: Individual Workers Editor (this project's `preview` Worker only), Account Settings Read{{fragment_d1_readme_write}} |
| Deploy | `CLOUDFLARE_DEPLOY_TOKEN` (environments `production`, and `beta` if used) | Account: Individual Workers Editor (this project's Workers for those environments only), Account Settings Read, Workers Scripts Read{{fragment_d1_readme_write}}. Zone: Workers Routes Edit |
| Infra plan | `CLOUDFLARE_INFRA_PLAN_TOKEN` (repository) | Account: Workers R2 Storage Read{{fragment_zone_owned_readme_transform_read}}{{fragment_d1_readme_read}}. Zone: DNS Read{{fragment_zone_owned_readme_read}} |
| Infra apply | `CLOUDFLARE_INFRA_APPLY_TOKEN` (environment `infra`) | Account: Workers R2 Storage Edit{{fragment_zone_owned_readme_transform_write}}{{fragment_d1_readme_write}}. Zone: DNS Edit{{fragment_zone_owned_readme_write}} |

Workers Scripts Read is account-scoped too, so the Deploy token can read every Worker's code and settings in the account, but not its secrets. Wrangler needs it to deploy a Worker whose last change didn't come from Wrangler (a secret or setting changed through the API or the dashboard). In that case, before uploading, it reads the Worker's routes through an account endpoint that neither Individual Workers Editor nor Workers Routes Edit can read (cloudflare/workers-sdk#16390).

{{fragment_infra_readme_transform_owned}}If a plan or apply fails with an authorisation error, the error names the
missing permission: add exactly that one.

The preview and deploy tokens can edit only this project's own Workers, named
by Wrangler environment: `{{slug}}-preview`, `{{slug}}-production` and, with a
beta, `{{slug}}-beta` (the name in `wrangler.jsonc` plus the environment). The
token script creates each as an empty stub that answers 404 before it makes
the tokens, because a token can only be scoped to a Worker that exists; the
first deploy replaces the stub. Scoping a token to a Worker names the Worker
by its tag, not its name.

Never add a per-Worker granular policy to an existing token by editing it in
place: such writes have failed or silently left a token with no policies.
Create a new token instead. Check a token's real contents with
`GET /accounts/<account id>/tokens/<token id>`, not the dashboard labels.

### Reissuing tokens with per-Worker scope

A project whose preview and deploy tokens still have the account-wide
"Workers Scripts Write" permission moves to per-Worker tokens by running
`node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
again, with `--rotate`. The script finds the Workers that already exist and
leaves them untouched, creates a stub for any that don't, makes the four new
tokens, stores them in Pass, sets the secrets, and then revokes the old
tokens the Pass items name. Re-render `.bootstrap/` first with the current
plugin (`render.mjs --bootstrap-only`) if the project's token definitions
predate this change.

{{fragment_r2_state_credentials}}

{{fragment_opentofu_version}}

### Variables

`CLOUDFLARE_ACCOUNT_ID` as a repository variable. It isn't confidential.

### Worker secrets

Set each runtime secret once per environment with
`pnpm exec wrangler secret put <NAME> --env <env>`. Setting one environment
never sets another. Local development reads them from `.dev.vars`, which is
gitignored.

{{fragment_sync_secrets_readme}}{{fragment_admin_readme}}{{fragment_turnstile_readme}}{{fragment_d1_readme}}## Disaster recovery

1. Run "Bootstrap OpenTofu state bucket".
2. Run "Infra" to recreate everything managed here.
3. Set the Worker secrets again, per environment.
4. Redeploy the latest release: run "Deploy" from its tag (and "Promote to
   production" where there's a beta).

## Teardown

Deliberately deleting the project's infrastructure:

{{fragment_infra_readme_teardown_owned}}{{fragment_infra_readme_teardown_shared}}

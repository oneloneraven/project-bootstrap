# Infrastructure

The identity stack for every project's admin section, managed here with
[OpenTofu](https://opentofu.org), the open-source fork of Terraform (same HCL,
providers and state format): the Zero Trust organisation, its login method,
one admin Access application per project with one shared owner policy, and
Turnstile widgets. The only things outside OpenTofu are the state bucket (it
must exist before OpenTofu can use it) and the CI credentials below.

State lives in the R2 bucket `{{slug}}-tfstate`, never in git.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `infra.yml` | PR touching `infra/` (plan); push to `main` (apply); manual | Format check, validate, plan; refuses any plan that deletes or replaces unless run by hand with `allow_deletes` ([Deleting resources](#deleting-resources)). Skips the repository's first push, before credentials exist |
| `bootstrap-state.yml` | Manual | Creates the state bucket if it's missing; safe to re-run |
| `rotate-turnstile-secret.yml` | Manual, on `main` | Rotates one widget's secret ([Rotating a widget's secret](#rotating-a-widgets-secret)) |

## Changing infrastructure

Everything `infra/` declares (the organisation settings, the login method, the
owner policy, every application and every widget) changes only through a PR to
`infra/`, applied by `infra.yml`. The organisation is set read-only in the
dashboard, so a change there is refused; make it in code.

- Before writing to Cloudflare through an API, an MCP tool or the dashboard,
  check whether `infra/` declares that resource. If it does, make the change
  there instead.
- In an emergency, a change by hand needs the maintainer's explicit OK first.
  Then declare the same resource in `infra/` straight away, with an `import`
  block for anything created by hand, so the next apply adopts it instead of
  failing to create it again.

{{fragment_deleting_resources}}

## What it manages

- **The Zero Trust organisation**, adopted with an `import` block. Only
  `is_ui_read_only` and `ui_read_only_toggle_reason` are set, so the dashboard
  is read-only and says why. Every other organisation setting is left as it is
  (`ignore_changes`), so the plan after the import should show
  changes to those two fields only.
- **The login method**: the Cloudflare login method (sign in with a
  Cloudflare account), adopted with an `import` block, restricted to members of
  the account.
- **One owner policy**: allows the one email in `OWNER_EMAIL`.
- **One admin application per project**, from the `apps` map. Every
  application gets the same settings, and none can be changed per project: the
  login method is the only one allowed and is signed in to without a choice
  screen, the binding cookie and `HttpOnly` are on, `SameSite` is `lax`,
  sessions last 8 hours, and the owner policy is the only policy.
- **Turnstile widgets**, from the `widgets` map, with `prevent_destroy`.

## Setup

1. The Cloudflare account has a Zero Trust organisation and its Cloudflare
   login method.
2. Create the CI tokens below, the R2 state credentials, and the GitHub
   secrets and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens, or follow this page by hand.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).

### Cloudflare API tokens

Create each as an account-owned token with a one-year expiry, scoped to this
account. Neither token has a zone permission.

| Token | GitHub secret | Permissions |
|---|---|---|
| Infra plan | `CLOUDFLARE_INFRA_PLAN_TOKEN` (repository) | Account: Workers R2 Storage Read, Access: Organizations, Identity Providers, and Groups Read, Access: Apps Read, Access: Policies Read, Turnstile Sites Read |
| Infra apply | `CLOUDFLARE_INFRA_APPLY_TOKEN` (environment `infra`) | Account: Workers R2 Storage Edit, Access: Organizations, Identity Providers, and Groups Edit, Access: Apps Edit, Access: Policies Edit, Turnstile Sites Edit |

The organisations permission is the one name not yet proven on a real
account: if creating the tokens fails because it doesn't resolve, the error
names it, and the dashboard's label for it is the one to use.

If a plan or apply fails with an authorisation error, the error names the
missing permission: add exactly that one.

Never add a per-Worker granular policy to an existing token by editing it in
place: such writes have failed or silently left a token with no policies.
Create a new token instead. Check a token's real contents with
`GET /accounts/<account id>/tokens/<token id>`, not the dashboard labels.

{{fragment_r2_state_credentials}}

{{fragment_opentofu_version}}

### Variables

`CLOUDFLARE_ACCOUNT_ID` as a repository variable. It isn't confidential.

`ACCESS_LOGIN_METHOD_ID` as a repository variable: the ID of the account's
Cloudflare login method (Zero Trust → Integrations → Identity providers). It
isn't confidential. The first apply adopts that login method.

`OWNER_EMAIL` as a repository secret: the one email every admin application
lets in. It is never committed.

## Adding a project's admin section

1. Add an entry to `apps` in `infra/terraform.tfvars.json`, keyed by project:

   ```json
   {
     "apps": {
       "example": { "name": "Example admin", "domain": "admin.example.com" }
     },
     "widgets": {}
   }
   ```

2. Open a PR. The plan shows the new application; merge it and the apply
   creates it.
3. Read the outputs: `app_aud["example"]` and `team_domain`. In the project's
   `wrangler.jsonc`, set `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` to them. The
   Worker checks the Access token against both.

## Adding a widget

Add an entry to `widgets` in `infra/terraform.tfvars.json`, keyed by project,
with its `name` and `domains` (and `mode`, `managed` by default):

```json
{
  "apps": {},
  "widgets": {
    "example": { "name": "example-forms", "domains": ["example.com"] }
  }
}
```

After the apply, `widget_sitekey["example"]` is the sitekey for the page. The
widget's secret isn't an output: read it on the widget's Turnstile page in the
Cloudflare dashboard.

## Rotating a widget's secret

1. Run "Rotate a Turnstile widget secret" on `main` with the widget's
   sitekey. Tick `invalidate_immediately` only if the old secret must stop
   working at once; otherwise Cloudflare keeps it valid for a grace period.
   The workflow never prints the new secret.
2. Read the new secret on the widget's Turnstile page.
3. In the project that verifies tokens with it, set it as that project's
   Worker secret.

## Importing existing applications, policies and widgets

An application, policy or widget that already exists is adopted with an
`import` block, not recreated. A runbook for importing existing projects'
resources will be linked here.

## Account guidance

The Cloudflare account behind the login method is the way into every admin
section. Keep it on passkey or security-key two-factor only, with no
authenticator-app or email fallback, and keep its backup codes somewhere other
than the passkey's own store.

## Disaster recovery

1. Run "Bootstrap OpenTofu state bucket".
2. Run "Infra" to recreate everything managed here.

## Teardown

Deliberately deleting the stack:

1. Set `is_ui_read_only` to `false` in a PR and let Infra apply it, so the
   dashboard can be edited again.
2. Remove the organisation and the login method from state, so the destroy
   leaves the account's own Zero Trust organisation and login method alone:
   `tofu state rm cloudflare_zero_trust_organization.this cloudflare_zero_trust_access_identity_provider.login`.
3. Remove `prevent_destroy` from every resource in a PR (the infra workflow
   refuses plans that delete, so run the destroy locally).
4. Locally, with the infra apply token and state credentials in your
   environment:
   `tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"`
   then `tofu destroy`.
5. Empty and delete the `{{slug}}-tfstate` bucket in the dashboard.
6. Revoke the two Cloudflare tokens and the R2 credentials.

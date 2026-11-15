# Module: cloudflare-identity

A central identity stack in OpenTofu: the Cloudflare account's Zero Trust
organisation, its login method, one admin Access application per project with
one shared owner policy, and Turnstile widgets, with state in R2. It has no
app, no web stack and no release artefact: the repository is `infra/` and its
workflows.

## 1. Depends on

`core` and `cloudflare-tofu-base`. It conflicts with `cloudflare-opentofu`:
both write the same token definitions, and a repository is one or the other.

## 2. Interview questions

None. The slug is limited to 40 characters: the state bucket is named from it.

### Plan warnings

- **The apply adopts what the account already has.** The Zero Trust
  organisation and its Cloudflare login method exist already, so the first
  apply imports them (`import` blocks) instead of creating them. The
  organisation's settings other than `is_ui_read_only` and its reason are left
  as they are, and the dashboard becomes read-only for the organisation.
  `service_token_inactivity` is declared in full with enforcement still off,
  because the API rejects an update that carries only part of it. Check with
  the user that nothing edits Zero Trust settings in the dashboard while this
  goes ahead, and say that the plan after the import should show changes to
  `is_ui_read_only`, its reason and `service_token_inactivity`'s threshold and
  action only.
- **Free private repository**: as in `cloudflare-tofu-base`.

## 3. Files

- `infra/`: provider and R2 backend (from `cloudflare-tofu-base`), the
  organisation, the login method, the owner policy, the admin applications
  (`apps.tf`) and the widgets (`widgets.tf`) from the `apps` and `widgets`
  maps in `terraform.tfvars.json`, outputs (`team_domain`, `app_aud`,
  `widget_sitekey`), and a README. Widget secrets are never outputs.
- The workflows `infra.yml` and `rotate-turnstile-secret.yml`.
  `infra.yml` matches `cloudflare-tofu-base`'s skeleton apart from its
  `TF_VAR_owner_email` and `TF_VAR_login_method_id` lines. The rotation
  workflow runs only by hand, on `main`, in the `infra` environment.
- `.bootstrap/cloudflare/tokens.json`: the infra plan and apply tokens. Neither
  has a zone permission, so the token script never asks for a zone id.

Every application gets the same settings, and a test checks the rendered
OpenTofu: one login method pinned with `allowed_idps` and signed in to
without a choice screen, the binding cookie, `HttpOnly`, `SameSite` `lax`,
8-hour sessions and the owner policy.

## 4. GitHub configuration

After `cloudflare-tofu-base`'s configuration. This module adds none.

## 5. Manual steps

Do these in order, after `cloudflare-tofu-base`'s steps.

### cloudflare-identity:1 Set the owner email and the login method

**Why:** every application lets in one email, and the first apply adopts the
account's Cloudflare login method by its ID.

**Do:**
1. `gh secret set OWNER_EMAIL --repo $R` and paste the owner's email at the
   prompt. It is never committed.
2. In the Cloudflare dashboard, Zero Trust → Integrations → Identity
   providers, find the Cloudflare login method and copy its ID. Then
   `gh variable set ACCESS_LOGIN_METHOD_ID --repo $R --body <id>`.

**Verify (Claude runs):** `gh secret list --repo $R` and
`gh variable list --repo $R`.
**Expected:** `OWNER_EMAIL` and `ACCESS_LOGIN_METHOD_ID` are listed, along with
the ones `cloudflare-tofu-base` set.

### cloudflare-identity:2 Apply the identity stack

**Why:** this creates the owner policy and adopts the organisation and the
login method.

**Do:** nothing by hand. Claude runs `gh workflow run infra.yml --repo $R`.
(The initial push skipped this workflow on purpose: no credentials existed
yet.)

**Verify (Claude runs):** `gh run watch --repo $R --exit-status`.
**Expected:** success. The organisation and the login method are imported, and
the organisation's only changes are `is_ui_read_only`, its reason and
`service_token_inactivity`'s threshold and action. On an
authorisation error, the log names the missing permission: the user adds
exactly that one to the infra token and Claude re-runs it. If the token
creation step in `cloudflare-tofu-base:1` failed on the permission "Access:
Organizations, Identity Providers, and Groups", it is the one name not yet
proven on a real account: use the dashboard's label for it.

### cloudflare-identity:3 Add the first project

**Why:** the stack does nothing visible until a project has an application or
a widget.

**Do:** nothing by hand unless the user has a project to add now: follow
"Adding a project's admin section" and "Adding a widget" in `infra/README.md`.

**Verify:** the user's confirmation.

## 6. Standards

None of its own.

## 7. Smoke check

Local, on the full render: `tofu -chdir=infra init -backend=false`,
`tofu -chdir=infra validate`, `tofu fmt -check -recursive infra`.

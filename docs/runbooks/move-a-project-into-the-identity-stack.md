# Move a project's admin Access and widgets into the identity stack

This runbook moves an existing project's admin Access application, its
policy and its Turnstile widgets out of the project's own OpenTofu stack and
into the central identity stack (a `cloudflare-identity` stack, here
`coraxia`). Nothing is destroyed or recreated along the way: the application
keeps its audience tag, each widget keeps its sitekey and secret, and the
admin section and forms keep working throughout.

Do one project at a time, and finish every step for it before starting the
next. Each step is its own PR, merged and applied before the next one starts.

## Before you start

- The identity stack is bootstrapped and its last Infra run shows no changes.
- The project's last Infra run shows no changes either, so nothing else is
  waiting to apply.
- `OWNER_EMAIL` in the identity stack is the email the project's policy lets
  in today. If it isn't, stop: the move would change who can sign in.
- Local OpenTofu matches the version both stacks pin, and you can read the
  project's state (its `infra/README.md`, "R2 state credentials").

Record these values from the project. None of them is secret:

| Value | Where to read it |
|---|---|
| The application's ID | `tofu -chdir=infra state show <application address>`, the `id` attribute |
| The application's name and domain | the same output |
| The audience tag | the same output (`aud`), or the project's output for it |
| The team domain | the identity stack's `team_domain` output |
| The project policy's address and ID | `tofu -chdir=infra state show <policy address>` |
| Each widget's address, name, domains, mode and sitekey | `tofu -chdir=infra state show <widget address>` |

A widget that several products' forms use belongs to the project whose
Worker verifies its tokens. Key it by that project.

## 1. The project stops managing them

**Do:** in the project, by PR:

1. Replace the application and each widget resource with a `removed` block,
   so OpenTofu forgets them without destroying them:

   ```hcl
   removed {
     from = cloudflare_zero_trust_access_application.admin
   }
   ```

   Keep the policy resource as it is for now: the application still uses it
   until step 2 applies.
2. Remove any output, variable or workflow step that reads the forgotten
   resources, such as an output for the audience tag or the widget's secret,
   or a step that writes them into `wrangler.jsonc`.
3. Where a workflow wrote the audience tag, team domain or sitekey into
   `wrangler.jsonc`, commit the recorded values there instead: `ACCESS_AUD`,
   `ACCESS_TEAM_DOMAIN` and `TURNSTILE_SITEKEY` in each environment's vars
   that uses them.

**Verify:** the PR's plan says `0 to add, 0 to change, 0 to destroy` and
lists every removed resource as forgotten ("will be removed from the OpenTofu
state but will not be destroyed"). After the apply, the admin section still
signs you in and the forms still pass Turnstile.

**Back out:** before the apply, close the PR. After it, put each resource
back with an `import` block using the IDs you recorded, by PR; the plan must
show no changes beyond the import.

## 2. The identity stack adopts them

**Do:** in the identity stack, by PR:

1. Add the project to `apps` in `infra/terraform.tfvars.json`, with the
   recorded name and domain, and each widget to `widgets`, with the recorded
   name, domains and mode.
2. Add an `import` block for each, in a file of its own such as
   `infra/imports.tf`:

   ```hcl
   import {
     to = cloudflare_zero_trust_access_application.admin["<project>"]
     id = "accounts/<account id>/<application id>"
   }

   import {
     to = cloudflare_turnstile_widget.site["<project>"]
     id = "<account id>/<sitekey>"
   }
   ```

**Verify:** the PR's plan imports each resource and:

- changes nothing on any widget. If a widget shows a change, stop and
  bring its entry in `widgets` into line with the recorded values;
- updates the application in place only, never replaces it. The policy
  becomes the identity stack's owner policy, and any setting that differs
  from the standard set (session length, the pinned login method, automatic
  redirect, the cookie settings) moves to it. Read each change before merging.

After the apply, `app_aud` for the project equals the recorded audience tag
and `widget_sitekey` equals each recorded sitekey. Sign in to the admin
section in a private window: you reach the sign-in page, and the owner gets
in.

**Back out:** before the apply, close the PR. After it, remove the project
from `apps` and `widgets` and add a `removed` block for each instead, by PR,
then put them back in the project as in step 1's back-out. The project's
plan then restores the old settings and policy.

Once the apply has succeeded, remove the `import` blocks by PR. The plan
shows no changes.

## 3. The project deletes its own policy

**Do:** in the project, by PR, delete the policy resource and the variables
only it used, such as the owner email and the login method ID, along with
the Actions secrets and variables that fed them. Merge it, then run Infra by
hand on `main` with `allow_deletes`, because the plan deletes the policy.

**Verify:** the plan deletes the old policy and nothing else. After the
apply, the admin section still signs the owner in.

**Back out:** nothing uses the policy any more, so sign-in doesn't depend on
it. If step 2 has to be backed out later, recreate the policy by PR first.

## 4. The project's tokens are reissued

**Do:** re-render the project's `.bootstrap/` files with the current plugin
(the bootstrap skill's "Adopting a module in an existing repository"), then
run `secrets.mjs cloudflare-tokens <project dir> --rotate`. The new tokens
have no Access or Turnstile permission, and the preview and deploy tokens
can edit only the project's own Workers. The script revokes the old tokens
once the new ones are stored and set.

**Verify:** `GET /accounts/<account id>/tokens/<token id>` for each new token
lists exactly the permissions in `.bootstrap/cloudflare/tokens.json`; the
next Infra run, a PR preview and a deploy all succeed.

**Back out:** run the step again with `--rotate`. Old tokens are revoked as
soon as the new ones are set, so there is no going back to them.

## 5. The project adopts the standard admin check and secrets

**Do:** in the project, by PR, bring the Worker into line with the
`cloudflare-opentofu` module's `admin` and `turnstile` options:

- the owner check in `src/lib/access.js`, which refuses unless the request
  carries a valid Access token for `ACCESS_AUD` from `ACCESS_TEAM_DOMAIN` and
  its email matches `OWNER_EMAIL`, and the admin routes behind it;
- the Turnstile check in `src/lib/turnstile.js`, which fails closed, wherever
  the project verifies a form;
- `sync-worker-secrets.yml`, with `TURNSTILE_SECRET_KEY` as a secret of the
  `production` environment, read from the widget's Turnstile page in the
  Cloudflare dashboard and set with `gh secret set TURNSTILE_SECRET_KEY --env production`.
  Run "Sync Worker secrets" once to prove it: it sets the same value the
  Worker already has.

**Verify:** the project's tests pass, and the next deploy keeps both the
admin section and the forms working.

**Back out:** revert the PR. The vars and secrets stay as they are.

## 6. Check it end to end

- An unauthenticated request to the admin hostname goes to the sign-in page.
- The owner signs in and reaches the admin section.
- Anyone else is refused: if the account has another member, signing in as
  them is refused by Access.
- Each form that uses a moved widget submits successfully on production, and
  on beta if there is one.
- The identity stack's and the project's next Infra runs both show no
  changes.

Then close the project's migration issue.

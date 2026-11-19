# Module: cloudflare-opentofu

A Cloudflare Worker serving the app's static assets and a `/api/health`
endpoint, deployed by wrangler from release tags, with the zone's DNS,
TLS, headers, cache rules and a `www` redirect in OpenTofu (the open-source
Terraform fork) and state in R2.

## 1. Depends on

`web-app` (and through it, `js-toolchain`).

## 2. Interview questions

- **`zone_name`**: the domain the app is served from. It must already be an
  active zone in the user's Cloudflare account. Ask them to confirm.
- **`beta`** (yes or no): with a beta, each release tag deploys to
  `beta.<zone>` and a person promotes a chosen tag to production with
  "Promote to production". Without one, each tag deploys straight to
  production.
- **`admin`** (yes or no): whether the app has an admin section for its
  owner. If yes, the module adds the admin hostname, its Worker route, the
  Access vars and an owner check in the Worker, and the project's Access
  application is added to the central identity stack by hand (a manual step).
  The owner's email, `OWNER_EMAIL`, is a Worker secret set through the "Sync
  Worker secrets" workflow.
- **`admin_subdomain`** (asked only when `admin` is yes; default `admin`): the
  hostname's first label, such as `admin` for `admin.<zone>`. One lower-case DNS
  label. There is no admin hostname on a beta: each admin hostname needs its
  own Access application, so the admin section is production only.
- **`turnstile`** (yes or no): whether the app has a public form guarded by a
  Turnstile widget that lives in the central identity stack. If yes, the module
  adds the sitekey var, a fail-closed verifier in the Worker's `src/lib`, and
  the "Sync Worker secrets" workflow, and the widget is added to the identity
  stack by hand (a manual step).
- **`d1`** (yes or no): whether the app keeps data in a D1 database. If yes, the
  module adds the database to OpenTofu, binds it as `DB` in every environment,
  applies migrations on each release tag's deploy, gives every PR's Preview its
  own database, and adds the D1 permissions to the project's tokens.

The slug is limited to 40 characters here: Worker names, the state bucket
and preview hostnames are built from it.

### Plan warnings

- **The app takes over the zone's apex.** OpenTofu adds a proxied
  placeholder A record for `<zone>` (and `beta.<zone>`), a proxied `www`
  CNAME to the apex with a rule that 301s `www.<zone>` to `https://<zone>`,
  and the production Worker route is `<zone>/*`. Ask the user to check the
  zone's DNS records in the dashboard. If the apex, `www.` or `beta.` already
  has a record, or the domain already serves something, stop and agree what
  happens to it before going on: apply fails on an existing CNAME and splits
  traffic with an existing A record. If the zone already has Redirect Rules,
  stop and agree what happens to them too: the apply fails while a
  `http_request_dynamic_redirect` ruleset exists.
- Without a beta, the first merged release deploys straight to the apex.
- **The bootstrap creates empty Workers before the first deploy.** The preview
  and deploy tokens may edit only this project's own Workers, and a token can
  only be scoped to a Worker that exists, so token creation first uploads a
  stub (it answers 404, with no routes or bindings) for the `preview`,
  `production` and, with a beta, `beta` environments. Say so, and that the
  first deploy replaces each stub.
- **With `admin`, `<admin_subdomain>.<zone>` is a new hostname.** OpenTofu
  adds a proxied placeholder A record for it and production gets a Worker
  route for it. If it already has a record, stop and agree what happens to it
  before going on. Say that its access control is added to the central
  identity stack by a manual step, so until then the Worker refuses
  everyone on it.

- **With `d1`, the app's data is in one account-wide-permissioned database.**
  The Preview, Deploy and Infra apply tokens gain D1 Write and the Infra plan
  token D1 Read, and Cloudflare can't scope either to one database. Say so.
  Production and beta share the database, so a migration in a beta deploy
  changes production's data too, and the live code must tolerate it (expand and
  contract).

## 3. Files

- `wrangler.jsonc`: environments `production`, `beta` (beta only),
  `preview` (the only one with workers.dev) and `e2e`, each repeating every
  binding. A Workers Preview inherits nothing from its environment, so a
  binding added to `env.preview` is repeated under `env.preview.previews`
  too; a test checks they match.
- With `admin`: the proxied admin DNS record (`infra/dns-admin.tf`), a
  production route for it, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (empty, so
  the check fails closed) and `ADMIN_HOST` in the production vars,
  `ADMIN_ACCESS_CHECK` `"off"` in the `e2e` environment and in
  `.dev.vars.example` for development only,
  `src/lib/access.js` (the owner check) and its tests, and a stub in
  `src/worker.js` that answers 404 to anyone the check refuses. No project
  token gains an Access or Turnstile permission.
- With `turnstile`: `TURNSTILE_SITEKEY` in the `production` (and `beta`)
  vars, empty so verification fails closed until the identity stack's
  `widget_sitekey` is set; Cloudflare's published always-pass test sitekey and
  secret as vars in `preview` (and its `previews` block) and `e2e`, and in
  `.dev.vars.example`; `src/lib/turnstile.js` (`verifyTurnstile`, which
  refuses on a missing token, secret or sitekey, a non-OK response, a timeout
  or anything but `success: true`) and its tests; and the manual workflow
  `sync-worker-secrets.yml`, whose `TURNSTILE_SECRET_KEY` step sets the secret
  on the production Worker and, with a beta, the beta Worker (see below). The
  secret is never a var and no wrangler file holds it.
- With `admin` or `turnstile`: the manual workflow `sync-worker-secrets.yml`
  ("Sync Worker secrets"). It runs on `main` only, in the `production`
  environment, with the deploy token, and has one step per secret the project
  has: `OWNER_EMAIL` with `admin` (production only, as admin has no beta host)
  and `TURNSTILE_SECRET_KEY` with `turnstile` (production and, with a beta,
  beta). Each secret is in its own step's env only, piped on stdin to
  `wrangler secret put`, never printed or written to a summary, and the step
  fails when its secret is empty.
- With `d1`: `infra/d1.tf` (a `cloudflare_d1_database` named after the slug,
  in `weur`, with `prevent_destroy`, and its `d1_database_id` output); a `DB`
  binding with `migrations_dir` `migrations` in the top level and every
  environment of `wrangler.jsonc`, with an empty `database_id` until it's set
  by PR from the output (`preview` and its `previews` block use
  `<slug>-preview`, which the Preview workflow replaces); an empty
  `migrations/` directory (`.gitkeep`, no migration); `D1 Write` on the
  Preview, Deploy and Infra apply tokens and `D1 Read` on Infra plan; a D1
  section in `infra/README.md`; and `wrangler d1 migrations apply` before
  `wrangler dev` in `dev`, `e2e:server` and `preview` (without `--env` in `dev`).
  The tag deploy records a Time Travel bookmark in its job summary, then runs
  `wrangler d1 migrations apply` before `wrangler deploy`. "Promote to
  production" doesn't migrate. `preview.yml` creates and migrates
  `<slug>-pr-<number>` for each PR, writes a temporary `.wrangler-preview.jsonc`
  that points the Preview's `DB` binding at it, and deletes the database
  when the PR closes.
- `infra/`: provider and R2 backend, DNS placeholder records (and `beta.`),
  CAA, TLS 1.2 minimum, HSTS, always HTTPS, DNSSEC, security headers, cache
  rules, and a README with setup, deleting resources, disaster recovery and
  teardown.
- The workflows `infra.yml`, `preview.yml`, `deploy.yml`, and `promote.yml`
  (beta only), and with `admin` or `turnstile` `sync-worker-secrets.yml`.
  `infra.yml` refuses plans that delete or replace; a manual run with
  `allow_deletes` applies one on purpose. `scripts/bootstrap-state.mjs`
  and `bootstrap-state.yml` come from `cloudflare-tofu-base`, which also
  carries the OpenTofu version pin for `infra.yml`.
- Merges into `package.json`: adds wrangler, and its `e2e:server` script
  runs `wrangler dev`, so e2e tests the real Worker. Allows `workerd`'s
  install script in `pnpm-workspace.yaml`.
- Application (first PR): `src/worker.js`, `test/worker.test.js`, and with
  `admin` also `src/lib/access.js` and `test/lib/access.test.js`, and with
  `turnstile` also `src/lib/turnstile.js` and `test/lib/turnstile.test.js`.

Every `runs-on` in this module's workflows is `ubuntu-26.04`, so a runner
image migration is a deliberate change: when GitHub moves `ubuntu-latest` to
a new image, move the pin to that image by hand.

## 4. GitHub configuration

After `cloudflare-tofu-base`'s configuration. Steps `github:cloudflare-opentofu:<n>`.

1. The deploy environments, each limited to the refs that may deploy from
   it, created and verified as in `github:cloudflare-tofu-base:1`:
   - `production`: `main` and tags `v*` with a beta, `admin` or `turnstile`
     (with a beta, promote runs from `main`; with `admin` or `turnstile`, so
     does "Sync Worker secrets"), or tags `v*` only with none of them;
   - `beta` (beta only): tags `v*`.

   Verify each one's expected refs: `["branch:main","tag:v*"]` for
   `production` with a beta, `admin` or `turnstile`, `["tag:v*"]` for `production`
   with none of them and for `beta`. If one fails, follow the fallback in
   `github:cloudflare-tofu-base:1`, recording it as skipped under
   `github:cloudflare-opentofu:1`.
2. With `d1`, add a row to `docs/threat-model.md`'s STRIDE table, after the
   existing rows, on the first PR's branch: threat "Cloudflare D1 permissions
   can't be scoped to one database, so a leaked Preview, Deploy or Infra apply
   token can read, change or delete every D1 database in the account",
   category Elevation of privilege, mitigation "Tokens are separate per
   purpose, held as environment or repository secrets and expire after a
   year, and the Workers edit permission is limited to this project's own
   Workers. `prevent_destroy` guards only OpenTofu plans, not a deletion
   through the API, and the Time Travel bookmark taken before each deploy
   covers a bad migration, not a deleted database, which can't be restored",
   status Accepted.

## 5. Manual steps

Do these in order. `infra/README.md` (rendered into the project) has the
same steps for later rebuilds.

### cloudflare-opentofu:1 Apply the infrastructure

**Why:** the Worker routes need the DNS records to exist before the first
deploy.

**Do:** nothing by hand. Claude runs `gh workflow run infra.yml --repo $R`.
(The initial push skipped this workflow on purpose: no credentials existed
yet.)

**Verify (Claude runs):** `gh run watch --repo $R --exit-status`.
**Expected:** success. On an authorisation error, the log names the missing
permission: the user adds exactly that one to the infra token and Claude
re-runs it.

### cloudflare-opentofu:2 Confirm DNSSEC

**Why:** DNSSEC isn't fully active until the DS record is published.
Cloudflare Registrar adds it itself, from the zone's CDS and CDNSKEY
records, within one to two days of DNSSEC being enabled.

**Do:** nothing by hand.

**Verify (Claude runs):** `dig +short DS <zone_name>`.
**Expected:** a DS record. If it isn't there yet, note it in the hand-over
rather than blocking, along with the fact that infra plans show
`status: "pending" -> "active"` on the DNSSEC resource until it is.

### cloudflare-opentofu:3 Add the admin section to the identity stack

Only with `admin`.

**Why:** the admin hostname refuses everyone until its Access application
exists and the Worker knows its audience tag and team domain.

**Do:**
1. In the central identity stack, add the project to `apps` in
   `infra/terraform.tfvars.json`, with a name and `<admin_subdomain>.<zone>`
   as its domain, by PR. After its apply, read the outputs: `app_aud` for the
   project and `team_domain`.
2. In this project's `wrangler.jsonc`, set `ACCESS_AUD` and
   `ACCESS_TEAM_DOMAIN` in the `production` vars to those two values, by PR.

**Verify:** an unauthenticated request to `https://<admin_subdomain>.<zone>/`
is sent to the sign-in page, and the signed-in owner reaches the admin stub.
Ask the user to try it and tell you what they see.

### cloudflare-opentofu:4 Set OWNER_EMAIL

Only with `admin`.

**Why:** the Worker checks the signed-in email against the owner's, and
refuses everyone while it isn't set.

**Do:**
1. The user runs `gh secret set OWNER_EMAIL --env production --repo $R` and
   enters the owner's email at the hidden prompt. They never paste it into
   chat, and it is never committed. With `turnstile` too, they also do step
   `cloudflare-opentofu:7`'s first action now: the workflow sets every secret
   the project has and fails on an empty one.
2. Claude runs `gh workflow run sync-worker-secrets.yml --repo $R --ref main`
   and watches it with `gh run watch --repo $R --exit-status`.

**Verify (Claude runs):** `pnpm exec wrangler secret list --env production`.
**Expected:** `OWNER_EMAIL` is listed.

### cloudflare-opentofu:5 Check Worker preview URLs (after the first PR)

**Why:** Cloudflare made preview URLs opt-in, and PR previews need them.

**Do:** after the first preview run, Workers & Pages → `<slug>-preview` →
Settings → Domains & Routes: Preview URLs enabled.

**Verify:** the PR's preview comment URL answers
`curl -s <url>/api/health` with `"ok":true`.

### cloudflare-opentofu:6 Add the Turnstile widget to the identity stack

Only with `turnstile`.

**Why:** the Worker refuses every token until the widget exists and
`TURNSTILE_SITEKEY` holds its sitekey.

**Do:**
1. In the central identity stack, add the project to `widgets` in
   `infra/terraform.tfvars.json`, keyed by the project slug, by PR:
   `"<slug>": { "name": "<slug>", "domains": ["<zone_name>"], "mode": "managed" }`.
   With a beta, `domains` also lists `beta.<zone_name>`. After its apply, read
   the `widget_sitekey` output for the project.
2. In this project's `wrangler.jsonc`, set `TURNSTILE_SITEKEY` in the
   `production` vars (and the `beta` vars, with a beta) to it, by PR.

**Verify (Claude runs):** `grep TURNSTILE_SITEKEY wrangler.jsonc`.
**Expected:** the `production` entry (and the `beta` one) is not empty.

### cloudflare-opentofu:7 Set the widget secret

Only with `turnstile`.

**Why:** the secret is never an output of the identity stack, and the Worker
refuses every token without it.

**Do:**
1. The user reads the secret on the widget's Turnstile page in the Cloudflare
   dashboard and runs
   `gh secret set TURNSTILE_SECRET_KEY --env production --repo $R`. It
   prompts with hidden input. They never paste it into chat.
2. Claude runs `gh workflow run sync-worker-secrets.yml --repo $R --ref main`
   and watches it with `gh run watch --repo $R --exit-status`. With `admin`
   too, one run covers both secrets once both environment secrets are set, and
   running it again is harmless.

**Verify (Claude runs):** `pnpm exec wrangler secret list --env production`
(and `--env beta`, with a beta).
**Expected:** `TURNSTILE_SECRET_KEY` is listed.

### cloudflare-opentofu:8 Set the D1 database ID

Only with `d1`.

**Why:** the Worker's `DB` binding has no database until `database_id` holds
the ID of the one OpenTofu creates.

**Do:** after the infra apply, read the `d1_database_id` output (`tofu output
d1_database_id` in `infra/`, with the state credentials) and set `database_id`
of the `DB` binding in `wrangler.jsonc`, in the top level and in `production`,
`beta` (with a beta) and `e2e`, by PR. `preview` and `previews` stay empty.

**Verify (Claude runs):** `grep database_id wrangler.jsonc`.
**Expected:** every entry but the two Preview ones is not empty.

## 6. Standards

`templates/standards-fragment.md`, rendered as "Cloudflare and OpenTofu".

## 7. Smoke check

Local, on the full render: `tofu -chdir=infra init -backend=false`,
`tofu -chdir=infra validate`, `tofu fmt -check -recursive infra`,
then `pnpm build && pnpm exec wrangler deploy --dry-run --env <env>` for
each environment, then js-toolchain's and web-app's smoke checks (e2e runs against
`wrangler dev`).

After the first release: `curl -s https://<host>/api/health` reports the
release tag (on `beta.<zone>` with a beta, after promoting on `<zone>`).

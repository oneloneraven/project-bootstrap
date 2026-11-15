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

## 3. Files

- `wrangler.jsonc`: environments `production`, `beta` (beta only),
  `preview` (the only one with workers.dev) and `e2e`, each repeating every
  binding. A Workers Preview inherits nothing from its environment, so a
  binding added to `env.preview` is repeated under `env.preview.previews`
  too; a test checks they match.
- `infra/`: provider and R2 backend, DNS placeholder records (and `beta.`),
  CAA, TLS 1.2 minimum, HSTS, always HTTPS, DNSSEC, security headers, cache
  rules, and a README with setup, deleting resources, disaster recovery and
  teardown.
- The workflows `infra.yml`, `preview.yml`, `deploy.yml`, and `promote.yml`
  (beta only). `infra.yml` refuses plans that delete or replace; a manual run
  with `allow_deletes` applies one on purpose. `scripts/bootstrap-state.mjs`
  and `bootstrap-state.yml` come from `cloudflare-tofu-base`, which also
  carries the OpenTofu version pin for `infra.yml`.
- Merges into `package.json`: adds wrangler, and its `e2e:server` script
  runs `wrangler dev`, so e2e tests the real Worker. Allows `workerd`'s
  install script in `pnpm-workspace.yaml`.
- Application (first PR): `src/worker.js`, `test/worker.test.js`.

Every `runs-on` in this module's workflows is `ubuntu-26.04`, so a runner
image migration is a deliberate change: when GitHub moves `ubuntu-latest` to
a new image, move the pin to that image by hand.

## 4. GitHub configuration

After `cloudflare-tofu-base`'s configuration. Steps `github:cloudflare-opentofu:<n>`.

1. The deploy environments, each limited to the refs that may deploy from
   it, created and verified as in `github:cloudflare-tofu-base:1`:
   - `production`: `main` (promote runs from it) and tags `v*`, or tags
     `v*` only without a beta;
   - `beta` (beta only): tags `v*`.

   Verify each one's expected refs: `["branch:main","tag:v*"]` for
   `production` with a beta, `["tag:v*"]` for `production` without one and
   for `beta`. If one fails, follow the fallback in
   `github:cloudflare-tofu-base:1`, recording it as skipped under
   `github:cloudflare-opentofu:1`.

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

### cloudflare-opentofu:3 Check Worker preview URLs (after the first PR)

**Why:** Cloudflare made preview URLs opt-in, and PR previews need them.

**Do:** after the first preview run, Workers & Pages → `<slug>-preview` →
Settings → Domains & Routes: Preview URLs enabled.

**Verify:** the PR's preview comment URL answers
`curl -s <url>/api/health` with `"ok":true`.

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

### Cloudflare and OpenTofu

Platform persona for this stack: routing correctness (including static
assets taking precedence over the Worker), Workers runtime limits (no Node
APIs unless `nodejs_compat` is on, CPU time, cold starts), caching headers
and edge cache behaviour, binding and secret handling per environment, and
whether the design is idiomatic for the platform rather than fighting it.

- **Everything provisionable is in OpenTofu** (`infra/`, HCL): declarative,
  repeatable, idempotent. Only data, runtime secrets, the state bucket and
  CI credentials live outside it.
- **State is in R2, never in git.** A `sensitive` value is still written to
  state in plain text.
- **Data-bearing resources have `prevent_destroy`.** The infra workflow
  refuses any plan that deletes, unless a person runs it by hand with
  `allow_deletes`.
- **Tools and runners are pinned exactly.** `tofu_version` in `infra.yml`
  is an exact release more than 72 hours old, upgraded by hand because
  Dependabot doesn't track it; every workflow runs on `ubuntu-26.04`, moved
  by hand when GitHub moves `ubuntu-latest`.
- **Least-privilege tokens**, one per job (preview, deploy, infra plan,
  infra apply), each scoped to the narrowest account or zone that offers the
  permission.
- **Every wrangler environment repeats every binding.** An environment that
  leaves one out doesn't inherit it, or worse, a misconfigured one inherits
  production's. A binding on `env.preview` is also repeated under
  `env.preview.previews`, because a Workers Preview inherits nothing from its
  environment.
- **Worker secrets reach the Worker only through the manual "Sync Worker
  secrets" workflow**, from a secret of the `production` GitHub environment,
  passed through env and piped on stdin, never printed or written to a
  summary, so a rebuild or a new maintainer needs no local Cloudflare
  credentials. This applies where the project has an admin section or a
  Turnstile-guarded form.
- **An admin section is checked twice.** Access decides who may sign in; the
  Worker then verifies the Access token (RS256 only, signature, `aud`, `iss`,
  `exp` and `nbf`) and accepts only `OWNER_EMAIL`, failing closed when
  anything is missing. `ADMIN_ACCESS_CHECK` is `"off"` only in e2e and
  development, never in production or beta. This applies where the project
  has an admin section.
- **A Turnstile check fails closed.** The Worker verifies every token
  server-side with the widget's secret, which is a Worker secret and never a
  var, and refuses on a missing token, secret or sitekey, an outage, a timeout
  or anything but `success: true`. The secret is set as described above. This
  applies where the project has a Turnstile-guarded form.
- **API responses for changing data send `Cache-Control: no-store`.**
- **Verify platform behaviour empirically** (a real request, `wrangler dev`,
  `--dry-run`) rather than trusting documentation alone.
- **Merging `infra/` is a production change.** It never takes
  `release: none`.

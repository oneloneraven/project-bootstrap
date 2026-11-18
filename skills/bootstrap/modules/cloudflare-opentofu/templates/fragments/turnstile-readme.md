## Turnstile

The public form is guarded by a Turnstile widget that lives in the central
identity stack (the `cloudflare-identity` repository), which never outputs its
secret. The widget covers `{{zone_name}}` and, with a beta, `beta.{{zone_name}}`.

- **Sitekey.** `TURNSTILE_SITEKEY` in the `production` vars (and the `beta`
  vars, with a beta) of `wrangler.jsonc` is empty until it is set, by PR, to
  the identity stack's `widget_sitekey` output for this project. While it is
  empty, `src/lib/turnstile.js` refuses every token. `preview` and `e2e` use
  Cloudflare's always-pass test keys, as does `.dev.vars.example` for local
  development, because those hostnames are not on the widget.
- **Secret.** `TURNSTILE_SECRET_KEY` is a Worker secret, never a var. It is
  read from the widget's Turnstile page in the Cloudflare dashboard, stored as
  the `TURNSTILE_SECRET_KEY` secret of the `production` environment on GitHub,
  and pushed to the Worker (and the beta Worker, with a beta) by "Sync Worker
  secrets". That workflow is manual, runs on `main` only, and passes the
  secret through the environment without printing it.

To set it the first time:

1. Run `gh secret set TURNSTILE_SECRET_KEY --env production`. It prompts for
   the value with hidden input.
2. Run "Sync Worker secrets" on `main`.
3. Check that `pnpm exec wrangler secret list --env production` (and
   `--env beta`, with a beta) lists `TURNSTILE_SECRET_KEY`.

To rotate it:

1. In the identity stack, run "Rotate a Turnstile widget secret" on `main`
   with the widget's sitekey. Tick `invalidate_immediately` only if the old
   secret must stop working at once.
2. Read the new secret on the widget's Turnstile page.
3. Run `gh secret set TURNSTILE_SECRET_KEY --env production` and enter it.
4. Run "Sync Worker secrets" on `main`.

Unless it was invalidated immediately, the old secret keeps working for
Cloudflare's grace period.


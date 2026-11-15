## Admin section

`{{admin_subdomain}}.{{zone_name}}` is the admin hostname. `infra/` holds its
proxied placeholder DNS record, `wrangler.jsonc` routes it to the Worker in
`production`, and the Worker serves it from `ADMIN_HOST`. The beta
environment has no admin hostname. The project's tokens hold no Access or
Turnstile permission: the Access application lives in the central identity
stack (the `cloudflare-identity` repository).

Sign-in is checked twice. Access decides who may reach the hostname. Then
`src/lib/access.js` verifies the Access token on every admin request (RS256
only, the signature, `aud`, `iss`, `exp` and `nbf`) and accepts only the email
in `OWNER_EMAIL`. It refuses everyone when anything is missing, and answers
404.

To switch it on:

1. In the central identity stack, add this project to `apps` with the name and
   `{{admin_subdomain}}.{{zone_name}}` as its domain, by PR. After the apply,
   its outputs give this project's `app_aud` entry and the `team_domain`.
2. In `wrangler.jsonc`, set `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in the
   `production` vars to those two values, by PR. Both are empty until then, so
   the admin hostname refuses everyone.
3. Set the owner's email as a Worker secret:
   `pnpm exec wrangler secret put OWNER_EMAIL --env production`.

`ADMIN_ACCESS_CHECK` is `"off"` only in `e2e` and, through `.dev.vars`, in
local development. Never set it in `production` or `beta`.


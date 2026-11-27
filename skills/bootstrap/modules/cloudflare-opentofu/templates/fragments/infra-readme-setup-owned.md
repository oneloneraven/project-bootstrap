1. The zone `{{zone_name}}` is active on Cloudflare.
2. Create the CI tokens below, the R2 state credentials, and the GitHub
   secrets and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens, or follow this page by hand.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).
5. Cloudflare Registrar adds the DS record within one to two days; check it
   with `dig +short DS {{zone_name}}`. Until then, plans show the DNSSEC
   status as `pending -> active`. That's expected, and it clears once the
   registry has the record.
6. In the dashboard, check the Worker's Preview URLs setting is on.
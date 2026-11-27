1. The zone `{{zone_name}}` is active on Cloudflare and managed by another
   project's stack, and nothing answers on `{{app_host}}` yet.
2. Create the CI tokens below, the R2 state credentials, and the GitHub
   secrets and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens, or follow this page by hand.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).
5. In the dashboard, check the Worker's Preview URLs setting is on.
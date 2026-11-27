1. Remove `prevent_destroy` from every resource in a PR (the infra workflow
   refuses plans that delete, so run the destroy locally).
2. Locally, with the infra apply token and state credentials in your
   environment:
   `tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"`
   then `tofu destroy`. It removes only this project's records; the zone stays
   with the stack that manages it.
3. Delete the Workers: `pnpm exec wrangler delete --env <env>` for each
   environment.
4. Empty and delete the `{{slug}}-tfstate` bucket in the dashboard.
5. Revoke the four Cloudflare tokens and the R2 credentials.
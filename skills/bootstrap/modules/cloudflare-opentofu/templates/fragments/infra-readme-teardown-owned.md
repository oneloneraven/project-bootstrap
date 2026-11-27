1. In a PR to `infra/`, set `cloudflare_zone_dnssec.app`'s `status` to
   `"disabled"` and let Infra apply it.
2. Wait until the zone's DNSSEC status is `disabled`. Cloudflare Registrar
   withdraws the DS record once the zone's CDS records are zeroed; check with
   `dig +short DS {{zone_name}}` returning nothing.
3. Wait at least 1.5 times the DS record's TTL before continuing.
4. Remove `prevent_destroy` from every resource in a PR (the infra workflow
   refuses plans that delete, so run the destroy locally).
5. Locally, with the infra apply token and state credentials in your
   environment:
   `tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"`
   then `tofu destroy`.
6. Delete the Workers: `pnpm exec wrangler delete --env <env>` for each
   environment.
7. Empty and delete the `{{slug}}-tfstate` bucket in the dashboard.
8. Revoke the four Cloudflare tokens and the R2 credentials.
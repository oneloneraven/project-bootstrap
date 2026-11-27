Everything `infra/` declares (the DNS records, the TLS, HTTPS, HSTS and DNSSEC
settings, and the security header, cache and redirect rules for
`{{zone_name}}`) changes only through a PR to `infra/`, applied by `infra.yml`.
The Worker's routes come from `wrangler.jsonc` and change through wrangler.
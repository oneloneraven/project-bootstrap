Everything `infra/` declares (this project's own DNS records in
`{{zone_name}}`) changes only through a PR to `infra/`, applied by `infra.yml`.
The zone's settings and rules belong to the stack that manages it: change them
there, never here. The Worker's routes come from `wrangler.jsonc` and change
through wrangler.
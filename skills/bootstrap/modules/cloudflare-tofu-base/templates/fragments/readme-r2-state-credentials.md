### R2 state credentials

`node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-r2 <project dir>` creates both and sets the secrets. By hand, create two R2 API tokens (R2 → Manage R2 API Tokens), both limited to the
`{{slug}}-tfstate` bucket:

| Token | Permission | GitHub secrets |
|---|---|---|
| State read-write | Object Read & Write | `TF_STATE_ACCESS_KEY_ID`, `TF_STATE_SECRET_ACCESS_KEY` (environment `infra`) |
| State read-only | Object Read only | `TF_STATE_READ_ACCESS_KEY_ID`, `TF_STATE_READ_SECRET_ACCESS_KEY` (repository, for PR plans) |

PR plans run with the read-only pair, so code in a pull request can't
rewrite state.
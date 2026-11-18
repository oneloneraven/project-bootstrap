The secrets of the admin section and of Turnstile reach the Worker one way. Each
is stored as a secret of the `production` environment on GitHub, and the manual
"Sync Worker secrets" workflow sets it on the Worker from there. The workflow
runs on `main` only, passes each secret through the environment and pipes it on
stdin, fails when one is empty, and never prints or records it. Nothing needs
local Cloudflare credentials, so a rebuild or a new maintainer runs the same
two steps: set the environment secret, then run the workflow.


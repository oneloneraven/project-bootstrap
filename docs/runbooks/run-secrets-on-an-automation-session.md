# Run the secrets steps on an automation session

`secrets.mjs` stores each credential in the password manager before it sets
it on GitHub. By default it runs on your own signed-in `pass-cli` session,
which can read every vault. This page covers running it on an automation
session instead: a personal access token limited to the `Dev` vault, signed
in to its own session directory.

The script never handles the token. You create it and sign in yourself, in
your own terminal.

## What changes on an automation session

- `item view`, `item create`, `item update`, `item trash` and `item untrash`
  are refused unless they say why the item is being accessed. The script sets
  `PROTON_PASS_AGENT_REASON` in the environment of `item view`, `item create`
  and `item trash`, for example `Store the Cloudflare Deploy token for
  my-project`. The reason is never an argument, so it doesn't appear in the
  process list. `item list` and the folder commands need no reason.
- The session can only see the vaults the token was limited to. The script
  defaults to the `Dev` vault, so limit the token to that vault and nothing
  else.
- The session must be allowed to create items, because the script stores
  every credential before it sets it. Vault access is granted as `viewer`
  unless you say otherwise, and a viewer fails at `item create` with
  `NotAllowed`. Grant `editor`.
- With editor access the script creates the project's folder in the `Dev`
  vault when it doesn't exist yet, named after the project's slug (or the
  organisation, for `board-app`), as it does on your own session.

## Set up

1. In your own signed-in session, create an agent with the shortest expiry
   you can work with, then give it editor access to the `Dev` vault:

   ```sh
   pass-cli agent create <name> --expiration 1w
   pass-cli agent access grant <name> --vault-name Dev --role editor
   ```

   Keep the agent's token out of chat, notes and files.
2. In your own terminal, choose a session directory and sign in. The token
   is read without echo, handed to `pass-cli login` through its environment
   and then unset:

   ```sh
   export PROTON_PASS_SESSION_DIR="$HOME/.local/state/pass-agent-<project>"
   read -rs PROTON_PASS_PERSONAL_ACCESS_TOKEN && export PROTON_PASS_PERSONAL_ACCESS_TOKEN && pass-cli login && unset PROTON_PASS_PERSONAL_ACCESS_TOKEN
   ```

   `pass-cli login --pat <token>` also works, but puts the token in the
   process list and your shell history, so don't use it.
3. Check the session: `pass-cli info` exits 0.
4. Run the step in the same terminal, so it inherits
   `PROTON_PASS_SESSION_DIR`:
   `node <plugin>/skills/bootstrap/scripts/secrets.mjs <step> <project dir>`.
   The preflight's `pass-cli info` and every item command use that session.

## Afterwards

Revoke the token in the password manager when you've finished, and delete the
session directory (`pass-cli logout` with the same `PROTON_PASS_SESSION_DIR`
set signs it out). A session left signed in is the exposure described in the
[threat model](../threat-model.md).

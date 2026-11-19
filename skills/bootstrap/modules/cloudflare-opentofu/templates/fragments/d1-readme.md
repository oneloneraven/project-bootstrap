## D1 database

The app's data lives in a D1 database named `{{slug}}`, declared in
`infra/d1.tf` with `prevent_destroy` because a deleted D1 database can't be
restored. Production and beta share it. It is bound as `DB` in every
environment of `wrangler.jsonc`, with `migrations_dir` set to `migrations`.

To switch it on:

1. Run "Infra" on `main` so OpenTofu creates the database.
2. Read the `d1_database_id` output (`tofu output d1_database_id` in `infra/`, with the state credentials in your environment) and set `database_id`
   to it for the `DB` binding in `wrangler.jsonc`, in the top-level entry and in
   `production`, `beta` (with a beta) and `e2e`, by PR. Leave `database_id`
   empty in `preview` and `previews`: the Preview workflow fills those in for
   each PR's own database.

To change the schema:

1. Run `pnpm exec wrangler d1 migrations create DB <name>` and write the SQL
   in the new file under `migrations/`.
2. `pnpm e2e:server` and `pnpm preview` apply every migration to a local
   database before they start the Worker.
3. Merge it. The release tag's deploy applies new migrations before the
   code is deployed, so the live code must work with the schema both before
   and after them: expand and contract, as in
   [versioning](../docs/versioning.md#database-migrations-expand-and-contract).

Before applying migrations, the deploy records a Time Travel bookmark in its
job summary, with the command to restore it:
`pnpm exec wrangler d1 time-travel restore {{slug}} --bookmark=<bookmark>`.
A restore overwrites the database in place, so it also discards every write
made since the bookmark. "Promote to production" doesn't migrate: beta and
production share the database, so the beta deploy already applied the
migrations.

Each PR's Preview gets its own database, `{{slug}}-pr-<number>`. The Preview
workflow creates it if it's missing, applies the migrations, and writes a
temporary `.wrangler-preview.jsonc` (never committed) that points the
Preview's `DB` binding at it. When the PR closes, merged or not, the workflow
deletes the database.

D1 Edit and D1 Read are account-wide permissions: Cloudflare can't scope them
to one database. The Preview, Deploy and Infra apply tokens can read, change
and delete every D1 database in the account, and the Infra plan token can
read them.


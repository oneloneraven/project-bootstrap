# Adding a module

A module is a folder under `skills/bootstrap/modules/<name>/`. The contract
is in [module-contract.md](../skills/bootstrap/reference/module-contract.md);
manual steps follow [manual-step-format.md](../skills/bootstrap/reference/manual-step-format.md).

1. **Open an issue** describing the stack and what the module sets up.
2. **Screen its default dependencies and vendors** against the BDS lists and
   record them in the manifest's `screening`. Each row needs `dependency`,
   `usedFor`, `maintainer`, `listed` (`Y` or `N`), `decision` and `screenedOn`
   (`YYYY-MM-DD`, the day it was screened); the render fails without them.
   Core renders the rows into the project's `docs/dependency-register.md`.
3. **Write `manifest.json`**: `dependsOn`, `conflictsWith` (for a stack that excludes another), `questions`, `files` (mark
   application files `"stage": "app"` so they ship in the first PR),
   `merge: true` to extend another module's JSON (such as `package.json`),
   `overrides` only to replace a file wholesale, `allowBuilds` for any
   package's install script, `requiredChecks`,
   `releasePaths`, `claudeIndexLines`.
4. **Write the templates.** Use `{{key}}` for answers and derived keys.
   GitHub Actions expressions (`${{ … }}`) pass through untouched. Pin every
   action by commit SHA with a version comment, and give every workflow
   least-privilege `permissions:`.
5. **Write `templates/standards-fragment.md`**: a `###` section with the
   stack's platform persona and its rules. It's added to the project's
   coding standards.
6. **Write `MODULE.md`** with the seven sections.
7. **Test it.** Add `tests/<module>.test.mjs` with render assertions, then
   render it with its dependencies into a temporary directory and run the
   module's smoke check for real.
8. Run `pnpm test` and the identifier guard, then open the PR with
   `release: minor`.

## Sharing text between modules

A module's manifest can declare `fragments`: a name for each file of text
that other modules' templates place with `{{fragment_<name>}}`. A fragment is
rendered with the same values as the file it lands in, so `{{slug}}` and the
other keys work inside it. Names are unique across the selected modules, and
an unknown name fails the render. Use it when two modules need the same prose
or code in files they each own, such as a README section.

## Building a Cloudflare stack module on the base

`cloudflare-tofu-base` holds the OpenTofu plumbing every Cloudflare stack
needs: the state bucket script and workflow, the R2 backend, the OpenTofu
version pin, the `infra` environment and the shared README sections. A stack
module, such as `cloudflare-opentofu`, builds on it like this:

1. Put `cloudflare-tofu-base` in `dependsOn`.
2. In `infra/main.tf`, place `{{fragment_tofu_terraform_block}}`, then the
   provider and the stack's own data sources.
3. In `infra/README.md`, place `{{fragment_deleting_resources}}`,
   `{{fragment_r2_state_credentials}}` and `{{fragment_opentofu_version}}`
   where they belong in the stack's own sections. Repeat the disaster
   recovery and teardown steps listed in the base's
   `templates/readme-shared-steps.md` in the stack's own lists; a test checks
   they are there.
4. Ship the stack's own `infra.yml`. It must match the base's
   `templates/infra.skeleton.yml` apart from its `TF_VAR_*` lines, which a
   test checks. Keep the `@@TOFU_VERSION@@` token in it: the base's scaffold
   step fills it in.
5. Write the stack's tokens, questions, resources and manual steps. Number
   them from 1 in the stack's own `MODULE.md`; the base's steps are
   `cloudflare-tofu-base:<n>`, run after the stack's token step.

Two stack modules that write the same files, such as the token definitions,
declare `conflictsWith` on each other.

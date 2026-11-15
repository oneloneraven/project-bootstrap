# Versioning

## Releases are tags

The version lives in exactly one place: a `vX.Y.Z` git tag on the commit it
was cut from, with a GitHub Release on that tag. Nothing reads a version from
a file. Any `version` field a tool insists on (such as `package.json`) is an
inert placeholder that automation never writes.

Merging to `main` integrates a change. Nothing is released until a tag is
cut, and tags are cut automatically from the PR's release label.

## Release labels

Every PR needs exactly one label before it can merge. A required check
(`check-label`) enforces this.

- **`release: major`**: a breaking change to data or behaviour that would
  break or surprise someone already using it: an incompatible schema change,
  a removed feature, a change needing manual migration.
- **`release: minor`**: a new capability or a significant behaviour change
  that is backward compatible. Also, once, a substantial internal rewrite
  that's worth a line in the version history even though nobody using it
  would notice.
- **`release: patch`**: a bug fix, or any other change someone using it
  could see or feel that doesn't clear the minor bar: polish, copy, small
  refinements.
- **`release: none`**: only for changes that never reach users: docs,
  workflows, tests, editor and repo config. Nothing that's deployed, applied
  or built into what users run qualifies, however small. CI rejects
  `release: none` when any changed file is outside the allowlist in
  `.github/release-paths.json`, and always on paths that deploy on their own
  (such as infrastructure and database migrations).

The test is "would someone using this notice or need to know?" Any yes is at
least a patch.

## Cutting a release

When a labelled PR merges, `release.yml`:

1. reads the label (`none` stops here);
2. finds the latest `vX.Y.Z` tag and computes the next version;
3. tags the PR's own merge commit and pushes only the tag;
4. creates a GitHub Release whose notes are the PR's What's new lines
   ([below](#whats-new)) and attaches any build artefact.

The tag is pushed with a short-lived token from the release GitHub App,
because a push made with the default `GITHUB_TOKEN` doesn't trigger other
workflows. The workflow never pushes to `main`, so branch protection is
unaffected. `workflow_dispatch` remains as a manual override.

## What's new

Release notes are the lines under the PR's "What's new" heading, one plain
sentence per change a user would notice. The release workflow puts them in the
tag message and the GitHub Release notes. A PR with an empty section, a
`release: none` PR and a manual release with no PR have empty notes, so
nothing is made up. `require-release-label.yml` fails a `major`, `minor` or
`patch` PR without the heading, or with only a placeholder such as "None".

### Adopting What's new in an existing project

Copy these from the plugin's core templates:

- `whats-new.mjs`, `check-whats-new.mjs` and the updated `plan-releases.mjs`
  into `.github/scripts/`;
- the What's new section and Announced item from the pull request template,
  and the Announced item from the definition of done;
- the What's new step in `require-release-label.yml`, and the tag message and
  `--notes-file` lines in `release.yml`.

## Database migrations: expand and contract

Where a project has a database, migrations run before the new code deploys,
so every migration must be safe for the code that's live right now.

- **Migrations are additive.** New tables, nullable or defaulted columns,
  indexes and non-destructive backfills are fine at any time.
- **Dropping or renaming takes two releases.** First release code that no
  longer needs the old table or column. Only then, in a later release, drop
  or rename it, with a first line saying why it's safe:
  `-- destructive-migration: nothing reads <table>.<column> since vX.Y.Z`.
- Record a restore point before migrating, where the platform offers one.

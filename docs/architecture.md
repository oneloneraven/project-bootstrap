# Architecture: the central systems

Who owns what across One Lone Raven's four central systems: Bootstrap, Coraxia, Engage and Guardian. Approved on 26 November 2026 ([ADR-0008](adr/0008-separate-the-central-systems-jobs.md), [design](superpowers/specs/2026-11-26-central-systems-architecture-design.md)). Change it with a new ADR.

## Why

Engage was about to become the security watcher as well as the release gate, the deploy-credential broker, and the home of users' personal data. Bootstrap already sets up Coraxia and decides what the rest check against. Without clear boundaries, one compromise could do the most damage and be the hardest to see: a compromised Engage could deploy anything *and* silence the warning. So the systems' jobs are separated on purpose, even where that means moving work that's already built.

## Principles

1. **One job per system: define, grant, operate, observe.**
2. **The observer can't change anything.** It's read-only everywhere, and holds no credential that grants access.
3. **The observer's settings live outside what it observes.** Its baseline, exceptions and accepted standard are on Cloudflare, behind the owner's passkey login, not on GitHub.
4. **Granting needs proof of the owner.** No credential is minted on a system's say-so alone. It needs a fresh sign-in from the owner.
5. **Standards are pinned.** Consumers use a released version of Bootstrap's standard, never a moving branch, and take a new one deliberately.
6. **No single compromise both grants and hides.** Every way of granting access shows up somewhere the observer reads.

## The systems

### Bootstrap: defines and sets up

- **What it is:** a Claude Code plugin run locally by the maintainer. It never runs as a service.
- **It owns the standard:**
  - its templates and module manifests;
  - the generated `conformance/rules.json`, which holds the conformance checks, the security checks and the organisation standard.
- **It publishes the standard with each release.** The release carries `rules.json` as an asset, and nothing reads Bootstrap's `main` for it.
- **It sets repositories up,** Coraxia and Guardian included, and writes each repository's `.bootstrap/record.json`: modules, flags, skipped steps, visibility and conformance exceptions.
- **It creates only the credentials nothing else can broker:**
  - preview tokens and infra plan tokens, from a bootstrap token the maintainer pastes and it then deletes;
  - Apps and their keys, into Proton Pass and GitHub.

### Coraxia: grants

- **Infra, as today:** the Zero Trust organisation, the login method, every admin Access application, Turnstile widgets and service tokens.
- **New: a small Worker, the broker.** It moves from Engage (supersedes Engage's ADR-0008).
  - It holds the parent token-minting secret and each repository's `token_policy`.
  - It mints a short-lived deploy credential for a GitHub Actions OIDC token only when it has an approved release from Engage, and that approval carries the owner's fresh Cloudflare Access token: signed by Access for the owner's email, for Engage's application, and issued within the last few minutes.
  - Engage can't forge that token, so a compromised Engage can't mint.
- **Once every deploy is brokered,** the long-lived `CLOUDFLARE_DEPLOY_TOKEN` and `CLOUDFLARE_INFRA_APPLY_TOKEN` secrets go from every repository.

### Engage: operates

- **What it does:** feedback, email, releases (the gate and the owner's approval click), health and usage, product hubs, and conformance (hygiene, not security) against a pinned Bootstrap release.
- **It holds no security baseline.** It shows Guardian's results on `/repositories` and under Needs you, through Guardian's read-only API.
- **Its GitHub App keeps only what operating needs:** issues and deployments write, and read for the rest.

### Guardian: observes

- **What it watches:**
  - the GitHub organisation and every repository, using the security checks in Bootstrap's standard;
  - the Cloudflare account's audit log: new API tokens, Access and policy changes, Worker deploys, and secret and D1 changes;
  - Engage and Coraxia as watched systems.
- **What it can touch:** nothing. It has its own GitHub App with read-only permissions, and a Cloudflare token that can only read the audit log.
- **Its settings:** the accepted standard version, the security exceptions and each repository's expected visibility live in its own D1. You edit them in its own small admin page behind Access, and every change is audited.
- **Alerts:**
  - It posts straight to the security Discord channel, within seconds for GitHub events and within 15 minutes for what's swept.
  - It pings a Better Stack heartbeat after every sweep, so if Guardian goes silent, an independent service says so.
- **It's set up by Bootstrap like any other repository,** and watches itself.

## Trust domains

- **GitHub** holds code, CI and the standard's source. If it's compromised, that alone can't mint a credential (the broker needs the owner's Access sign-in) and can't change what Guardian accepts (Guardian's settings are on Cloudflare).
- **Cloudflare** holds the runtime, identity, secrets and Guardian's settings. It's protected by the owner's passkey-only Cloudflare login. If it's compromised, that shows in its own audit log, which Guardian reads and alerts on from outside Cloudflare's dashboard.
- **Local** means the maintainer's machine and Proton Pass, used by Bootstrap.
- **Better Stack** is an independent dead-man's switch for Guardian.


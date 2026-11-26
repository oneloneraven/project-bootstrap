# Central systems: who owns what

Status: approved by the maintainer on 26 November 2026 (D29). This sets the boundaries between One Lone Raven's four central systems before more is built across them. Each system's own specs follow from it.

## Why

Engage was about to become the security watcher as well as the release gate, the deploy-credential broker, and the home of users' personal data. Bootstrap already sets up coraxia and decides what the rest check against. Without clear boundaries, one compromise could do the most damage and be the hardest to see: a compromised Engage could deploy anything *and* silence the warning. So the systems' jobs are separated on purpose, even where that means moving work that's already built.

## Principles

1. **One job per system: define, grant, operate, observe.**
2. **The observer can't change anything.** It's read-only everywhere, and holds no credential that grants access.
3. **The observer's settings live outside what it observes.** Its baseline, exceptions and accepted standard are on Cloudflare, behind the owner's passkey login, not on GitHub.
4. **Granting needs proof of the owner.** No credential is minted on a system's say-so alone. It needs a fresh sign-in from the owner.
5. **Standards are pinned.** Consumers use a released version of bootstrap's standard, never a moving branch, and take a new one deliberately.
6. **No single compromise both grants and hides.** Every way of granting access shows up somewhere the observer reads.

## The systems

### project-bootstrap: defines and sets up

- **What it is:** a Claude Code plugin run locally by the maintainer. It never runs as a service.
- **It owns the standard:**
  - its templates and module manifests;
  - the generated `conformance/rules.json`, which holds the conformance checks, the security checks and the organisation standard.
- **It publishes the standard with each release.** The release carries `rules.json` as an asset, and nothing reads bootstrap's `main` for it.
- **It sets repositories up,** coraxia and Guardian included, and writes each repository's `.bootstrap/record.json`: modules, flags, skipped steps, visibility and conformance exceptions.
- **It creates only the credentials nothing else can broker:**
  - preview tokens and infra plan tokens, from a bootstrap token the maintainer pastes and it then deletes;
  - Apps and their keys, into Proton Pass and GitHub.

### coraxia: grants

- **Infra, as today:** the Zero Trust organisation, the login method, every admin Access application, Turnstile widgets and service tokens.
- **New: a small Worker, the broker.** It moves from Engage (supersedes Engage's ADR-0008).
  - It holds the parent token-minting secret and each repository's `token_policy`.
  - It mints a short-lived deploy credential for a GitHub Actions OIDC token only when it has an approved release from Engage, and that approval carries the owner's fresh Cloudflare Access token: signed by Access for the owner's email, for Engage's application, and issued within the last few minutes.
  - Engage can't forge that token, so a compromised Engage can't mint.
- **Once every deploy is brokered,** the long-lived `CLOUDFLARE_DEPLOY_TOKEN` and `CLOUDFLARE_INFRA_APPLY_TOKEN` secrets go from every repository.

### Engage: operates

- **What it does:** feedback, email, releases (the gate and the owner's approval click), health and usage, product hubs, and conformance (hygiene, not security) against a pinned bootstrap release.
- **It holds no security baseline.** It shows Guardian's results on `/repositories` and under Needs you, through Guardian's read-only API.
- **Its GitHub App keeps only what operating needs:** issues and deployments write, and read for the rest.

### Guardian: observes

- **What it watches:**
  - the GitHub organisation and every repository, using the security checks in bootstrap's standard;
  - the Cloudflare account's audit log: new API tokens, Access and policy changes, Worker deploys, and secret and D1 changes;
  - Engage and coraxia as watched systems.
- **What it can touch:** nothing. It has its own GitHub App with read-only permissions, and a Cloudflare token that can only read the audit log.
- **Its settings:** the accepted standard version, the security exceptions and each repository's expected visibility live in its own D1. You edit them in its own small admin page behind Access, and every change is audited.
- **Alerts:**
  - It posts straight to the security Discord channel, within seconds for GitHub events and within 15 minutes for what's swept.
  - It pings a Better Stack heartbeat after every sweep, so if Guardian goes silent, an independent service says so.
- **It's set up by bootstrap like any other repository,** and watches itself.

## Trust domains

- **GitHub** holds code, CI and the standard's source. If it's compromised, that alone can't mint a credential (the broker needs the owner's Access sign-in) and can't change what Guardian accepts (Guardian's settings are on Cloudflare).
- **Cloudflare** holds the runtime, identity, secrets and Guardian's settings. It's protected by the owner's passkey-only Cloudflare login. If it's compromised, that shows in its own audit log, which Guardian reads and alerts on from outside Cloudflare's dashboard.
- **Local** means the maintainer's machine and Proton Pass, used by bootstrap.
- **Better Stack** is an independent dead-man's switch for Guardian.

## What moves

| From | To | What |
|---|---|---|
| Engage | coraxia | The deploy-credential broker, its parent secret and `token_policy` (supersedes Engage's ADR-0008) |
| Engage (planned) | Guardian | The security checks, events, sweep and alerts in the 26 November conformance and security draft |
| bootstrap `main` | bootstrap releases | Where consumers read the standard |
| `.bootstrap/` (gitignored) | `.bootstrap/record.json` (committed) | Each repository's own facts |

## Delivery

1. **Record the decisions:**
   - this page, as `docs/architecture.md` in project-bootstrap;
   - an ADR in each of bootstrap, coraxia and Engage;
   - Guardian's first ADR when its repository exists.
2. **Four specs, in this order:**
   1. **bootstrap:** `record.json`, the manifests' environments, secrets and Apps, `rules.json` version 2 with the security group and organisation standard, and publishing the standard with each release.
   2. **Guardian:** new. It's bootstrapped first, then built.
   3. **coraxia:** the broker Worker, moved from Engage.
   4. **Engage:** conformance against a pinned release, reading Guardian's API, the broker removed, and Engage's 26 November draft replaced.

   Guardian needs bootstrap's release with the standard. The broker move doesn't depend on either.
3. **The backfill:** one PR per repository, with `record.json` and the `.gitignore` change. Then the organisation's owner steps: 2FA required, and secure methods only.

## Decided by the maintainer

- D25 (1): a slim public record.
- Security alerts within minutes, through events plus a sweep.
- Alert only, never revert.
- One security Discord channel.
- The organisation gets its own row, with 2FA required. Passkeys are preferred; GitHub can't enforce them alone.
- D26 (1): security exceptions and the standard live on Cloudflare, not GitHub.
- D27 (1): a separate observer service.
- D28 (1): the broker moves to coraxia and needs the owner's Access sign-in.
- Q10: the observer is called Guardian.

## Calls made here, for review

- **This page lives in project-bootstrap,** as the system that sets the others up. The other repositories' ADRs link to it.
- **Conformance stays in Engage.** It's hygiene that drives Needs you, not security.
- **Guardian has its own small admin page,** rather than its settings being edited through Engage. Otherwise a compromised Engage could change what Guardian accepts.
- **The broker checks the owner's Access token was issued in the last 5 minutes.** The builder can tune that window.

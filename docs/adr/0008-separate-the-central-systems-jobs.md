# 8. Separate the central systems' jobs

## Status

Accepted.

## Context

Engage was becoming the release gate, the deploy-credential broker, the home of users' personal data and the security watcher, all at once. Bootstrap already sets up Coraxia and decides what the others check against, and Engage read that standard from Bootstrap's moving `main` branch. A compromised Engage could both deploy anything and silence the warning.

## Decision

Each of the four central systems has one job, as set out in [the architecture](../architecture.md):

- **Bootstrap defines the standard and sets repositories up.** It publishes the standard with each release.
- **Coraxia grants access, for people and machines.** That includes the deploy-credential broker, which mints only on the owner's fresh Access sign-in.
- **Engage operates the products.**
- **Guardian observes everything,** read-only, with its settings on Cloudflare rather than GitHub. It alerts directly, and has an independent heartbeat.

Consumers pin a released version of the standard. Each repository commits `.bootstrap/record.json` with its own facts, and the rest of `.bootstrap/` stays local.

## Consequences

- No single compromise both grants access and hides it.
- There's one more system to run (Guardian), and Coraxia gains running code (the broker).
- Engage's broker (its ADR-0008) and its planned security checks move out of Engage.
- Taking a new version of the standard is a deliberate step in each consumer.

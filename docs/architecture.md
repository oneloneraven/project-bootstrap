# Architecture: the core stack

Who does what across One Lone Raven's core stack: Bootstrap, Coraxia, Engage and Guardian. The full architecture, including how the systems trust each other, is kept in the private vault. Change it with a new ADR.

## One job each

- **Bootstrap defines and sets up.** It's a Claude Code plugin the maintainer runs locally, never a service. It owns the standard every repository is held to: its templates, its module manifests and the checks generated from them. It publishes that standard with each release, and sets new repositories up, writing each one's `.bootstrap/record.json`.
- **Coraxia grants access** to the products' admin sections, for people and for machines.
- **Engage operates the products:** feedback, email, releases, health and usage, and conformance against a pinned release of Bootstrap's standard.
- **Guardian observes.** It checks every repository against Bootstrap's standard, and it can't change anything.

## Principles

1. **One job per system: define, grant, operate, observe.**
2. **The observer can't change anything.**
3. **Standards are pinned.** Consumers use a released version of Bootstrap's standard, never a moving branch, and take a new one deliberately.

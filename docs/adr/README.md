# Architecture decision records

Significant, hard-to-reverse decisions, one per file, in
[Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Title, Status, Context, Decision, Consequences. Numbered `NNNN-title.md`.

An accepted ADR is never edited. A changed decision gets a new ADR, and the
old one's status becomes "Superseded by ADR-NNNN".

| ADR | Decision |
|---|---|
| 0001 | Record architecture decisions |
| 0002 | Screen dependencies and vendors against BDS boycott lists |
| 0003 | Enforce model routing with an executor agent and a plugin mod |
| 0004 | Limit every subagent spawn to one at a time |
| 0005 | Force Sonnet on every subagent spawn |
| 0006 | Automate project credentials and the board from a template |
| 0007 | Sync organisation boards with a GitHub App |
| 0008 | Separate the central systems' jobs |

Every ADR is kept in the private vault, at `oneloneraven-vault/project-bootstrap/adr/`. This index lists their numbers and titles only.

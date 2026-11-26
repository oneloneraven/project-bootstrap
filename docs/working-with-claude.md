# Working with Claude

How Claude is run on this project, to get good results without spending
tokens on work that doesn't need the most capable model.

## Model routing

One Sonnet-class subagent does all delegated work, one at a time.

- **The main session runs an Opus-class model.** It owns design, scoping
  issues, architecture decisions, review judgement, anything security- or
  privacy-sensitive, approvals, and the final verification before anything
  is called done.
- **Delegation is a choice, not a requirement.** The main session makes
  small, clear fixes itself, where writing a brief and checking the report
  would cost more than the change. Substantial work goes to at most one
  Sonnet-class subagent at a time (`model: sonnet`): dependency bumps,
  running test suites and reporting their output, board and label
  housekeeping, executing an agreed plan step by step, bulk renames, doc
  updates from a settled decision, digging through CI logs, and longer
  investigations.
- **No sub-sessions, no mix of sessions and subagents, and no parallel
  workers**, even when their files don't overlap. Extra or parallel agents
  use up subscription token limits too quickly. Sub-sessions were tried
  first because they show in the sidebar, but they couldn't be governed.
- **Long or open-ended work is split into sequential subagent runs.** The
  main session decides between them.
- **Follow-ups go to the existing subagent**, not a new one.
- **Subagents work in the main checkout**, not a worktree of their own.
  Work is sequential, so there's nothing to isolate, and a fresh worktree
  starts cold (dependencies installed again, nothing built). While a subagent
  is running, the main session doesn't write, commit or switch branches there.
- **Briefs are self-contained**: the files involved, what done looks like,
  and the instruction to run only the affected tests while working and the
  project's full check once before pushing, with slow commands (test suites,
  e2e) in the foreground, never in the background.
- **The main session checks the subagent's results** (the diff, the real
  test output) before reporting them as done.

The bootstrap skill is the scripted case. Its `bootstrap-executor` agent
(`agents/bootstrap-executor.md`) does scaffolding and its smoke check,
GitHub configuration and the first-PR mechanics, while the main session
keeps the interview, the plan, each go-ahead, repository creation and the
initial push, and the verification. The plugin's routing mod
(`hooks/register.js`) forces every subagent onto Sonnet, whatever its type
or the model the call asks for (forks inherit the parent's model and are
exempt), and refuses a second subagent while one is active:
ADR-0003 (in the vault),
ADR-0004 (in the vault),
ADR-0005 (in the vault).

## Memory

- One fact per file, with frontmatter: name, one-line description, type
  (user, feedback, project, reference).
- `MEMORY.md` is the index: one line per memory, nothing else.
- Update an existing memory rather than adding a duplicate; delete one that
  turns out to be wrong.
- Don't save what the repo already records (code, docs, git history).

## Keeping context small

- `CLAUDE.md` is an index of one-line rules linking here and to the other
  docs. Add a rule as a line and its detail to a doc, never a paragraph to
  `CLAUDE.md`.
- Docs are short and split by topic. A doc that grows past a few screens
  gets split.
- Redirect long command output to a file and read its tail.

## Operational lessons

- There's no such thing as a flaky test, only a bad test or a real bug.
  Capture the full output and find the cause.
- Wait on PR checks with `gh pr checks --watch --fail-fast` and act on the
  first failure at once.
- Run the type checker locally before pushing; CI runs it as its own job.
- Run the e2e suite once per verification pass, not twice by default.
- Before blaming a file watcher for stale output, check for a duplicate dev
  server (`ps aux`).
- Never `pgrep -f` inside a `bash -c` wait loop: it matches itself.
- Test setup never reaches real external services. Local secrets files hold
  real keys.
- Check what the platform already provides before building ops tooling, and
  prefer the platform's newest feature unless there's a stated reason not to.
- Treat Claude-written docs as unverified until a person confirms them,
  especially anything phrased as "by design".
- When a needed tool or library is missing, say so and discuss options
  before improvising a workaround.
- Check an item's full stated scope before calling it done.

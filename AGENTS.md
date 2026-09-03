# git-turn — agent reference

`git-turn` is a git extension that snapshots the worktree after every commit an AI agent makes, grouped into "turns" within a session. Use it to inspect, diff, or roll back what an agent did — including mid-session, from inside your own tool loop.

Run commands as `git turn <command>` (or `node <repo>/bin/git-turn <command>` if not installed globally). All output is plain text on stdout; there is no `--json` flag yet, so parse text output if you need structured data.

## Setup (once per repo)

```sh
git turn init
```

Installs a post-commit hook, starts a session, and sets up refs. Safe to re-run. Works in bare+worktree repos (finds hooks dir via `--git-common-dir`).

## Implemented commands

### `git turn log [--with-prompts] [--no-cache]`
List turns in the current session: turn number, short SHA, commit subject, files-changed stat. `--with-prompts` includes the first line of the agent prompt for each turn if captured. `--no-cache` bypasses the SQLite read cache and reads refs/notes directly.

### `git turn show <N>`
Full diff for turn `N`, plus the captured prompt/session note if present. Use this to see exactly what one turn changed.

### `git turn diff <N> [M]`
Diff turn `N-1` vs `N` if `M` omitted, otherwise diff turn `N` vs turn `M` directly.

### `git turn blame <file> [--no-cache]`
Per-line attribution: each line of `<file>` is labeled with the session (first 8 characters of the session id) and turn number that last touched it, e.g. `f17a78b9:3`. Unlike `log`/`show`/`diff`, attribution spans every session in the repo, not just the current one — a line from an earlier, unrelated session still resolves to that session's label. Lines from commits that are not git-turn turns render as `<sha7> (not a turn)`; uncommitted lines render as `(uncommitted)`; lines in untracked-only files that the snapshot-diff fallback cannot attribute render as `(unattributed)`. `--no-cache` bypasses the SQLite read cache and enumerates turns by walking `refs/git-turn/sessions/` directly.

### `git turn bisect <cmd> [--no-cache]`
Binary-searches turn snapshots across all sessions, restoring the worktree to each candidate turn in turn and running `<cmd>` there. Requires a clean worktree and exits nonzero immediately if the worktree is not clean — it will not stash or discard anything for you. Snapshots the pre-bisect state before starting and always restores it on exit, including on SIGINT/SIGTERM. `<cmd>` runs through the shell with the caller's own privileges — the same trust boundary as `git bisect run <cmd>` — so do not pass a bisect command to an agent-controlled `<cmd>` you would not run directly yourself. Exit codes follow the `git bisect run` convention: `0` means the candidate is good, `125` means untestable/skip, `128` or above aborts the search entirely, and any other nonzero means the candidate is bad. Progress (`Bisecting N turns with: ...`, per-candidate `testing...`/`PASS`/`FAIL`/`SKIP`) and the final verdict are plain text on stdout — there is no `--json` flag, consistent with the note at the top of this file.

### `git turn status`
Current session ID, turn count, and hook health (whether the post-commit hook is installed and wired to the right ref).

### `git turn cost [--all]`
Token usage and estimated $ cost for the current session, computed from captured usage metadata and fetched LiteLLM pricing. `--all` reports across all sessions, not just the current one.

### `git turn revert <N>`
Restores the worktree to the exact state captured at turn `N` (destructive to uncommitted state — check `git status` first). Logs the operation so it can be undone.

### `git turn redo`
Undoes the last `revert`, restoring the worktree to its pre-revert state.

### `git turn gc [--keep-sessions N] [--rebuild]`
Prunes session refs older than the N most recent sessions (default 10). `--rebuild` forces the SQLite cache to rebuild from refs/notes instead of pruning.

## Not yet implemented

`branch --from <N>`, `session new|list` are listed in `--help` but exit with "not yet implemented" — do not rely on them.

## Storage model (for anything reading git internals directly)

- `refs/git-turn/sessions/{id}/turn-{N}` — snapshot refs, one per turn
- `refs/notes/git-turn` — per-commit metadata (session id, cc_session, timestamp, usage); **overwritten in place** on each turn, not appended — prior values only survive in the notes-ref commit history (`git log refs/notes/git-turn`)
- `refs/git-turn/format` — a discovery blob (JSON: version, tool, schema, ref_pattern, notes_ref) so other tooling can detect git-turn without guessing ref layout
- `.git/git-turn/ops/` — revert/redo operation log
- SQLite read cache (Node 22+, `node:sqlite`) mirrors refs/notes for fast `log`/`cost` reads; rebuilt via `gc --rebuild` or automatically if stale

## Requirements

Node.js 22+, Git 2.x.

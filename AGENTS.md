# git-turn — agent reference

`git-turn` is a git extension that snapshots the worktree after every commit an AI agent makes, grouped into "turns" within a session. Use it to inspect, diff, or roll back what an agent did — including mid-session, from inside your own tool loop.

Run commands as `git turn <command>` (or `node <repo>/bin/git-turn <command>` if not installed globally). All output is plain text on stdout; there is no `--json` flag yet, so parse text output if you need structured data.

## Setup (once per repo)

```sh
git turn init
```

Installs a post-commit hook, starts a session, and sets up refs. Safe to re-run. Works in bare+worktree repos (finds hooks dir via `--git-common-dir`). Respects `core.hooksPath` (Husky, lefthook, ...) — installs there instead of the default hooks dir, appending to an existing foreign hook file rather than overwriting it. If `git turn status` ever reports a hook as `shadowed by core.hooksPath=...`, a stale git-turn hook exists at the default location that git will never invoke — re-run `git turn init` to fix.

## Implemented commands

### `git turn log [--with-prompts] [--no-cache]`
List turns in the current session: turn number, short SHA, commit subject, files-changed stat. `--with-prompts` includes the first line of the agent prompt for each turn if captured. `--no-cache` bypasses the SQLite read cache and reads refs/notes directly.

### `git turn show <N>`
Full diff for turn `N`, plus the captured prompt/session note if present. Use this to see exactly what one turn changed.

### `git turn diff <N> [M]`
Diff turn `N-1` vs `N` if `M` omitted, otherwise diff turn `N` vs turn `M` directly. Both `diff` and `show` colorize output the same way `git diff` does — ANSI colored when stdout is a TTY, plain when piped. Override with `NO_COLOR=1` (forces plain) or `FORCE_COLOR=1` (forces color even when piped); `NO_COLOR` wins if both are set.

### `git turn blame <file> [--no-cache]`
Per-line attribution: each line of `<file>` is labeled with the session (first 8 characters of the session id) and turn number that last touched it, e.g. `f17a78b9:3`. Unlike `log`/`show`/`diff`, attribution spans every session in the repo, not just the current one — a line from an earlier, unrelated session still resolves to that session's label. Lines from commits that are not git-turn turns render as `<sha7> (not a turn)`; uncommitted lines render as `(uncommitted)`; lines in untracked-only files that the snapshot-diff fallback cannot attribute render as `(unattributed)`. `--no-cache` bypasses the SQLite read cache and enumerates turns by walking `refs/git-turn/sessions/` directly.

### `git turn bisect <cmd> [--no-cache]`
Binary-searches turn snapshots across all sessions, restoring the worktree to each candidate turn in turn and running `<cmd>` there. Requires a clean worktree and exits nonzero immediately if the worktree is not clean — it will not stash or discard anything for you. Snapshots the pre-bisect state before starting and always restores it on exit, including on SIGINT/SIGTERM. `<cmd>` runs through the shell with the caller's own privileges — the same trust boundary as `git bisect run <cmd>` — so do not pass a bisect command to an agent-controlled `<cmd>` you would not run directly yourself. Exit codes follow the `git bisect run` convention: `0` means the candidate is good, `125` means untestable/skip, `128` or above aborts the search entirely, and any other nonzero means the candidate is bad. Progress (`Bisecting N turns with: ...`, per-candidate `testing...`/`PASS`/`FAIL`/`SKIP`) and the final verdict are plain text on stdout — there is no `--json` flag, consistent with the note at the top of this file.

### `git turn heatmap [--no-cache]`
Calendar heatmap of turn activity. Like `blame`/`bisect` and unlike `log`/`show`/`diff`, this spans every session in the repo, not just the current one (cross-session scope). Cell intensity is turn count per calendar day, with density levels computed relative to the busiest day within the rendered window — not model or cost, since no turn carries model/token data until prompt capture ships — so the visible grid always spans the full `Less` -> `More` range regardless of the repo's overall activity level. The grid always ends today and spans at most 53 weeks, further narrowed to fit `process.stdout.columns`; there is no `--since`/range flag, and if older turns fall outside that window the output reports how many were excluded rather than silently dropping them. Below the grid, a summary block prints `Total turns`, `Active days`, `Busiest day`, `First turn`, `Last turn`, `Longest streak`, `Current streak`, and `Avg per active day` — deliberately no token/cost/model stats; use `git turn cost` for those. Output is plain text on stdout, no `--json` flag, no interactivity; ANSI color is emitted only when `NO_COLOR` is unset and stdout is a TTY (or `FORCE_COLOR` is set), degrading to ASCII density glyphs (` `, `.`, `:`, `+`, `#`) otherwise. `--no-cache` bypasses the SQLite read cache and walks `refs/git-turn/sessions/` directly, same as `blame`/`bisect`.

### `git turn status`
Current session ID, turn count, and hook health (whether the post-commit hook is installed and wired to the right ref).

### `git turn cost [--all]`
Token usage and estimated $ cost for the current session, computed from captured usage metadata and fetched LiteLLM pricing. `--all` reports across all sessions, not just the current one.

### `git turn record-prompt`
Reads one JSON object on stdin — `{ prompt, model, usage, latency_ms, tool_summary }`, all fields optional — and merges the supplied fields into the latest turn of the current session's note. Always targets the latest turn (no `--turn N` flag); the target is resolved via the turn index, never bare `HEAD`. Merges rather than overwrites, so repeat calls accumulate and the post-commit hook's `session_id`/`turn_n`/`snapshot_sha`/`ts` fields are always preserved. Unconditionally redacts secrets found in `prompt` — there is no opt-out flag — and reports a redaction count on stderr. `usage` is expected in Anthropic's shape (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`) so `git turn cost` can price it; `tool_summary` is a tool-name-to-count object, e.g. `{"Read": 5, "Edit": 2, "Bash": 1}`. Fails with `git turn: <message>` on stderr and exit 1 on malformed JSON, a non-string `prompt`, a non-object `usage`, empty stdin, or a session with no turns yet. Example:

```sh
echo '{"prompt":"why did this break","model":"claude-sonnet-4-5","usage":{"input_tokens":1200,"output_tokens":340}}' | git turn record-prompt
```

No wrapper or hook ships yet that constructs this payload automatically — the caller is the operator or a future Claude Code Stop-hook.

### `git turn revert <N>`
Restores the worktree to the exact state captured at turn `N` (destructive to uncommitted state — check `git status` first). Logs the operation so it can be undone.

### `git turn redo`
Undoes the last `revert`, restoring the worktree to its pre-revert state.

### `git turn redact <N>`
Post-hoc remediation: scrubs turn `N`'s captured `prompt` field to `[REDACTED]`, leaving `model`/`usage`/`latency_ms`/`tool_summary` intact (D-01). Runs immediately with no confirmation prompt (D-02). No-ops (prints "nothing to redact") when the turn has no captured prompt, so repeat calls don't needlessly grow the linear `refs/notes/git-turn` commit chain. **This is necessary but not sufficient** — the pre-redaction note blob is still present and reachable in the git object store afterward; every successful `redact` prints a pointer to `git turn gc --purge-notes`, which is the step that actually removes it.

### `git turn gc [--keep-sessions N] [--rebuild]`
Prunes session refs older than the N most recent sessions (default 10). `--rebuild` forces the SQLite cache to rebuild from refs/notes instead of pruning.

### `git turn gc --purge-notes`
Permanently removes old note history from `refs/notes/git-turn` — the step that actually deletes a pre-redaction note blob after `redact <N>` has replaced its content. Sequence: collapses the ref's entire commit history to a single parentless commit holding its *current* tree, expires that ref's reflog (non-fatal if the ref has no reflog), then runs `git gc --prune=now`. Prints a loud stderr warning before running and never prompts for confirmation (D-02).

Empirically verified (06-RESEARCH.md Focus Question 7) and important to understand before running:
- Reflog expiry plus `git gc --prune=now` **alone** does not remove the old blob — `git notes add -f` always commits the new notes-tree with the previous notes commit as its *parent*, so the old version stays reachable as an ordinary ancestor of the ref tip regardless of reflog state. The history-collapse step is what actually severs that chain.
- `git gc --prune=now` is **repository-wide**, not scoped to this one ref — it also permanently deletes any other unreachable object in the repo with no ref or reflog protecting it. Git has no ref-scoped object pruning.
- The purge discards note history for **every** commit's note, not only the one that leaked — there is no finer-grained purge available in git's object model for this ref shape.

Neither `git filter-repo` nor BFG Repo-Cleaner are alternatives — neither has documented handling of the `refs/notes/*` namespace.

### `git turn session new [--from <session_id>:<turn_n>]`
Starts a new session. `--from` records a durable `forked_from: {session_id, turn_n}` lineage link (written to `refs/git-turn/sessions/{id}/meta`, not just the mutable `session.json`) — validates the referenced turn actually exists before creating the session. Without `--from`, behaves like the session-creation half of `init` (no hook/format-blob work, just a fresh session).

### `git turn session list`
Lists every session that has ever had a turn or meta ref (not just the currently-active one) — session id, turn count, and `forked_from` lineage if the session was created with `--from`. The current session is marked with `*`.

### `git turn export [--since <ref>] [--output <path>]`
Bundles just the git-turn ref namespace (`refs/git-turn/sessions/**`, `refs/notes/git-turn`, `refs/git-turn/format`) into a `git bundle` file — for handing turn/session history to another clone without granting full repo access. `--since <ref>` makes it incremental (excludes everything already reachable from `<ref>`); the receiving side needs that ref locally to unbundle an incremental export. Default output is `git-turn-export-<timestamp>.bundle` in the current directory. Read-only/export-only — there is no import/merge command yet, pull the refs in with `git fetch <bundle> 'refs/git-turn/*:refs/git-turn/*' 'refs/notes/git-turn:refs/notes/git-turn'`.

## Not yet implemented

`branch --from <N>` is listed in `--help` but exits with "not yet implemented" — do not rely on it. (Note: `session new --from` exists and covers lineage tracking; `branch --from` is the separate, heavier operation of creating a new worktree from a turn snapshot, per ROADMAP Phase 6 — blocked on the Warren API.)

## Storage model (for anything reading git internals directly)

- `refs/git-turn/sessions/{id}/turn-{N}` — snapshot refs, one per turn
- `refs/git-turn/sessions/{id}/meta` — durable per-session metadata blob (`{session_id, started, branch, forked_from}`); unlike `session.json`, this persists after the session is no longer active, so `session list` can always show fork lineage
- `refs/notes/git-turn` — per-commit metadata; the post-commit hook writes `{session_id, turn_n, snapshot_sha, ts}` via `git notes add -f` (`src/hooks/post-commit.js`). `prompt`/`model`/`latency_ms`/`usage`/`tool_summary` are written by `git turn record-prompt` via read-merge-write (`updateNote()` in `src/git.js`) — never a blind overwrite for that path, so the hook's own fields survive every `record-prompt` call. **Overwritten in place** on each turn, not appended — prior values only survive in the notes-ref commit history (`git log refs/notes/git-turn`)
- `refs/git-turn/format` — a discovery blob (JSON: version, tool, schema, ref_pattern, notes_ref) so other tooling can detect git-turn without guessing ref layout
- `.git/git-turn/ops/` — revert/redo operation log
- SQLite read cache (Node 22+, `node:sqlite`) mirrors refs/notes for fast `log`/`cost` reads; rebuilt via `gc --rebuild` or automatically if stale

## Requirements

Node.js 22+, Git 2.x.

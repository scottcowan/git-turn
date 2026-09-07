# git-turn

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

**Tech stack:** Node.js, git CLI (no libgit2), optional SQLite for read cache

**Repo:** https://github.com/scottcowan/git-turn

## What it is

A git extension (`git turn <cmd>`) that automatically groups agent commits into turns and makes them queryable. Works with any AI coding agent that makes git commits (Claude Code, Cursor, Aider, opencode).

## Storage model

- **Refs** — `refs/git-turn/sessions/{id}/turn-{N}` point at dangling snapshot commits
- **Snapshots** — dangling `commit-tree` commits with two trees: index state + full worktree (including untracked)
- **Notes** — `refs/notes/git-turn` stores `{session_id, turn_n, snapshot_sha, ts}` per turn on the HEAD commit. `prompt`/`model`/`latency_ms`/`usage` are read defensively where present but nothing shipped writes them yet (Phase 4, not built).
- **Session meta** — `refs/git-turn/sessions/{id}/meta` durable per-session metadata (fork lineage via `session new --from`), survives after the session is no longer active
- **Op log** — `.git/git-turn/ops/` content-addressed operation log (jj-style) for undo/redo
- **SQLite cache** — shipped (`src/cache.js`, `d591cff`) — read cache for fast `log`/`cost` reads, rebuilt via `gc --rebuild` or automatically if stale

## Key Decisions

- **Forensics-first** — primary use is audit ("which turn broke this?"), not undo
- **No server required** — everything in local git object store and refs
- **No shell interpolation** — all git calls via `execFile(git, args[])`, never string concat
- **Hook fires on every commit** — serialized via pending-promise to prevent concurrent writes
- **Read-only turns skipped** — no commit = no snapshot (Option 1)
- **Separate from warren** — works in any git repo; warren is optional for `git turn branch`

## Current State

**Shipped:** v0.1 (Working CLI, 2026-08-09) through v0.2 (SQLite cache + bisect/blame). `session`/`export` shipped ad hoc from todos, same pattern as the SQLite cache did.

13 commands working end-to-end: `init`, `log`, `show`, `diff`, `blame`, `bisect`, `revert`, `redo`, `status`, `gc`, `cost`, `session` (new/list), `export`. Full test suite (93 tests). Hook installs via absolute path for cross-repo compatibility, and respects `core.hooksPath` (Husky/lefthook) instead of assuming the default hooks dir.

**Not yet implemented:** `branch --from <N>` (Phase 6, blocked on the Warren API).

**Known issues:** none currently tracked — see `.planning/todos/pending/` for open work (`git turn heatmap` and secret redaction on notes are the current pending items).

## Prior art

- pi-rewind (arpagon) — dangling commit-tree, two-tree snapshot, pending-promise pattern
- copilot-timeline-session (mmcs-work) — untracked exclusion, hash-keyed sidecar
- Jujutsu — content-addressed op log, op restore via update-ref only

---
*Last updated: 2026-09-07*

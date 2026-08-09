# git-turn

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

**Tech stack:** Node.js, git CLI (no libgit2), optional SQLite for read cache

**Repo:** https://github.com/scottcowan/git-turn

## What it is

A git extension (`git turn <cmd>`) that automatically groups agent commits into turns and makes them queryable. Works with any AI coding agent that makes git commits (Claude Code, Cursor, Aider, opencode).

## Storage model

- **Refs** — `refs/git-turn/sessions/{id}/turn-{N}` point at dangling snapshot commits
- **Snapshots** — dangling `commit-tree` commits with two trees: index state + full worktree (including untracked)
- **Notes** — `refs/notes/git-turn` stores prompt, model, latency per turn on the HEAD commit
- **Op log** — `.git/git-turn/ops/` content-addressed operation log (jj-style) for undo/redo
- **SQLite cache** — (planned) read cache for fast `git turn log`, `blame`, `bisect` queries

## Key Decisions

- **Forensics-first** — primary use is audit ("which turn broke this?"), not undo
- **No server required** — everything in local git object store and refs
- **No shell interpolation** — all git calls via `execFile(git, args[])`, never string concat
- **Hook fires on every commit** — serialized via pending-promise to prevent concurrent writes
- **Read-only turns skipped** — no commit = no snapshot (Option 1)
- **Separate from warren** — works in any git repo; warren is optional for `git turn branch`

## Current State

**Shipped:** v0.1 — Working CLI (2026-08-09)

8 commands working end-to-end: `init`, `log`, `show`, `diff`, `revert`, `redo`, `status`, `gc`. Full test suite (23 tests). Hook installs via absolute path for cross-repo compatibility.

**Known issues at v0.1:**
- `git turn log` output label says "turn N session …" (snapshot commit message verbatim) — needs cleaner formatting in v0.2
- No SQLite read cache yet — log/blame will be slow on large histories

**Next milestone goals (v0.2):**
- SQLite read cache for fast `log`, `blame`, `bisect`
- `git turn bisect <cmd>` and `git turn blame <file>`

## Prior art

- pi-rewind (arpagon) — dangling commit-tree, two-tree snapshot, pending-promise pattern
- copilot-timeline-session (mmcs-work) — untracked exclusion, hash-keyed sidecar
- Jujutsu — content-addressed op log, op restore via update-ref only

---
*Last updated: 2026-08-09 after v0.1 milestone*

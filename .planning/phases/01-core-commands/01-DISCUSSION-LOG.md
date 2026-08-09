# Phase 1: Core commands - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-09
**Phase:** 1-core-commands
**Areas discussed:** revert/redo semantics, diff command scope, status output design, gc retention policy, format discovery blob (init)

---

## Format discovery blob (init)

User surfaced this unprompted during area selection. At `git turn init`, write a machine-readable blob to `refs/turns/.format` so external tools can detect git-turn without parsing session files. Warren reads it; git-turn writes it.

| Option | Description | Selected |
|--------|-------------|----------|
| User-provided spec | Write JSON blob via `git hash-object -w --stdin` + `git update-ref refs/turns/.format $BLOB` | ✓ |

**User's choice:** Write format discovery blob at init  
**Notes:** Exact JSON schema TBD but must include `version` and `tool` fields. Keeps Warren decoupled from git-turn internals.

---

## revert / redo semantics

### What does `git turn revert <N>` restore?

| Option | Description | Selected |
|--------|-------------|----------|
| Worktree + index only | Restores files on disk. HEAD stays put. Non-destructive. | ✓ |
| Worktree + index + HEAD | Also moves HEAD via reset --hard. Rewrites history. | |

**User's choice:** Worktree + index only

---

### What can `git turn redo` undo?

| Option | Description | Selected |
|--------|-------------|----------|
| Last revert only | LIFO. Simple. No state stack needed. | ✓ |
| Any op from op log | Multi-step undo. Requires full undo model. | |
| You decide | Let planner pick simplest fit. | |

**User's choice:** Last revert only

---

### Cross-branch revert policy

| Option | Description | Selected |
|--------|-------------|----------|
| Hard fail | Error and exit. Existing branch-check in restoreSnapshot propagates. | ✓ |
| Warn and proceed | Print warning but restore anyway. | |

**User's choice:** Hard fail

---

## diff command scope

### What trees does `git turn diff N M` compare?

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot trees (git-turn's view) | Diffs worktree-trees of snapshots. Preserves untracked-file visibility. | ✓ |
| HEAD commits at those turns | Diffs actual HEAD shas. Familiar git output, loses untracked visibility. | |

**User's choice:** Snapshot trees

---

### What should `git turn diff N` (single arg) do?

| Option | Description | Selected |
|--------|-------------|----------|
| Diff turn N-1 vs turn N | Consistent with `git turn show N`. | ✓ |
| Diff turn N vs current worktree | Shows drift since turn N. | |

**User's choice:** Diff turn N-1 vs turn N

---

## status output design

### What should `git turn status` show?

| Option | Description | Selected |
|--------|-------------|----------|
| Session summary only | Session ID, turn count, branch, hook health, started time. Fast. | ✓ |
| Session summary + pending changes | Also diffs against latest snapshot. | |

**User's choice:** Session summary only

---

### What does 'hook health' mean?

| Option | Description | Selected |
|--------|-------------|----------|
| File presence check only | `.git/hooks/post-commit` exists and contains 'git-turn'. Zero overhead. | ✓ |
| Test-fire the hook | Dry-run invocation. Adds latency. | |

**User's choice:** File presence check only

---

## gc retention policy

### Default session retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep last 10 sessions | Configurable via --keep-sessions N. | ✓ |
| Keep last 5 sessions | More aggressive. | |
| Keep indefinitely unless flag passed | Safest default. | |

**User's choice:** Keep last 10 sessions

---

### What gets deleted on gc?

| Option | Description | Selected |
|--------|-------------|----------|
| Refs only | Delete turn refs; let git's own GC reclaim objects. | ✓ |
| Refs + force-pack | Also run `git gc --prune=now`. More thorough but risky. | |

**User's choice:** Refs only (user asked "what cleans up the old commits?" — answered: git's background GC handles dangling commits after refs are deleted)

---

### Print git gc hint?

| Option | Description | Selected |
|--------|-------------|----------|
| Print hint | After pruning: "Snapshot objects will be reclaimed on next `git gc`" | ✓ |
| Silent | No mention of git gc. | |

**User's choice:** Print hint

---

## Claude's Discretion

None — user selected recommended options for every decision.

## Deferred Ideas

- `blame`, `bisect`, `branch`, `session` commands — Phase 3 / Phase 6
- SQLite read cache — Phase 2
- Prompt capture — Phase 4

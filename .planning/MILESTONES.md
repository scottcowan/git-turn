# Milestones

## v0.3 Prompt Capture (Shipped: 2026-10-01)

**Phases completed:** 3 phases, 8 plans, 16 tasks

Known deferred items at close: 2 (see STATE.md Deferred Items)

**Key accomplishments:**

- Zero-dependency `redact(text)` scanner: 10 vendor regex patterns (AWS/GitHub/OpenAI/Anthropic/Slack/Google/Stripe/PEM/generic) plus Shannon-entropy fallback with SHA/UUID whitelist, proven against 22 node:test fixtures including ReDoS bound and no-bypass surface checks.
- Added `updateNote()` to src/git.js — a bounded read-compare-retry merge wrapper around git-notes that preserves the post-commit hook's forensic fields (session_id/turn_n/snapshot_sha/ts) instead of the blind overwrite `addNote()` performs.
- Guarded ALTER TABLE migration adds `usage`/`tool_summary` columns to the SQLite read cache in place, plus a new `updatePromptFields()` writer using per-column COALESCE for merge-not-overwrite semantics.
- `git turn record-prompt` reads one JSON blob from stdin and merges prompt/model/usage/latency_ms/tool_summary into the latest turn's note via `updateNote()`, redacting the prompt through Phase 4's scanner and best-effort mirroring into the SQLite cache — the last missing writer in the v0.3 milestone.
- Task 1 — `show.js` fix + `--with-prompts` gate + first-ever test coverage:
- cost.js now resolves its per-turn notes lookup via `parseSnapshotMessage(sha).headSha` instead of the bare snapshot sha, with new end-to-end test coverage proving a correct $0.0105 total from real captured usage with zero network access.
- `git turn redact <N>` scrubs a turn's captured prompt field to `[REDACTED]` via merge-write on the correctly-resolved head sha, leaving every other note field byte-identical and syncing the SQLite read cache.
- `git turn gc --purge-notes` ships a real, empirically-verified purge: it collapses `refs/notes/git-turn` to a single parentless commit holding the current (redacted) tree, expires the ref's reflog, then runs `git gc --prune=now` — the only sequence that actually removes an old note blob from the object store, per 06-RESEARCH.md Focus Question 7's live repro that disproved the milestone's original reflog-expire-only assumption.

---

## v0.2 Read Cache + Blame/Bisect (Shipped: 2026-09-17)

**Phases completed:** 2 phases, 8 plans, 18 tasks

**Key accomplishments:**

- Cache-first cross-session turn enumeration, head_sha reverse index with collision reporting, real-ancestry topology ordering, and unified-diff/blame-porcelain parsers plus an untracked-file forward annotator, all in a new `src/blame-util.js` built on multi-session test fixtures.
- `git turn blame <file>` — real `git blame --porcelain` mapped through the head_sha turn index for tracked files, with a snapshot-diff annotator fallback for untracked-only content, attributing every line across all git-turn sessions (D-01, D-02).
- `git turn bisect <cmd>` binary-searches cross-session turn snapshots with a first-bad-index search, live per-candidate PASS/FAIL/SKIP progress, `git bisect run` exit-code semantics (0/125/128+/null), and a guaranteed worktree restore on every exit path including SIGINT/SIGTERM.
- Pure calendar-day bucketing, data-relative density levels, activity summary stats, and a bounded Sunday-first week-column grid model for `git turn heatmap`, built and unit tested (23 tests) with zero git dependency.
- Full `git turn heatmap` module behavior — ANSI/ASCII grid rendering with balanced resets, an activity-only summary block, and cross-session `run(args)` enumeration — built on Plan 01's pure grid model, proven by 20 new unit/integration tests (43 total in this file, 138 in the full suite).
- `git turn heatmap` wired into the CLI dispatcher and --help text, documented in README.md/AGENTS.md against D-01 through D-04, and human-verified legible at wide/80-col/40-col terminal widths with correct NO_COLOR/FORCE_COLOR/piped behavior.
- Fixed `git turn heatmap` to scale density levels against the rendered grid's own busiest day instead of the entire all-time turn history, closing the WR-01 gap from 03.1-VERIFICATION.md.

---

## v0.1 Working CLI (Shipped: 2026-08-09)

**Phases completed:** 1 phases, 6 plans, 11 tasks

**Key accomplishments:**

- node --test glob fix, HOME-isolated makeTestRepo() helper, and read-only `git turn diff` implementing D-04 (N M) and D-05 (N vs N-1) with empty-tree fallback
- One-liner:
- Paired revert/redo stateful commands sharing a pre_revert_snapshot_sha op log contract: revert captures current state before restoring turn N, redo finds and restores that captured state via LIFO op search
- gc command prunes stale session turn refs using for-each-ref creatordate ordering, default keep=10, with current-session guard and D-10 hint message
- Three test files covering diff (D-04, D-05), status (D-06, D-07), and init format blob (D-11); all pass with node --test; includes Rule 1 fix to snapshotWorktree in git.js
- Integration tests for revert, redo, and gc using real temp git repos: covers D-01 HEAD-unchanged, D-02 LIFO redo, D-03 branch mismatch, D-08/D-09 session pruning, D-10 hint string, plus auto-fixed snapshotWorktree parent-commit bug

---

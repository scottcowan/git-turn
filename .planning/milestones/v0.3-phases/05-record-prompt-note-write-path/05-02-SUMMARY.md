---
phase: 05-record-prompt-note-write-path
plan: 02
subsystem: database
tags: [sqlite, node:sqlite, schema-migration, cache]

# Dependency graph
requires: []
provides:
  - "src/cache.js migrateSchema() — guarded, idempotent ALTER TABLE migration for turns.usage and turns.tool_summary"
  - "upsertTurn() extended to persist usage/tool_summary as JSON text"
  - "updatePromptFields(sessionId, turnN, {...}) exported writer with COALESCE merge-not-overwrite semantics"
  - "src/cache.test.js — first dedicated test file for the cache module (7 tests)"
affects: [05-03, record-prompt-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema columns added post-launch go into openDb() as guarded ALTER TABLE statements caught narrowly on /duplicate column name/i, never into the CREATE TABLE block, so pre-existing databases upgrade in place without data loss"
    - "Metadata-only cache writers (updatePromptFields) use COALESCE(?, column) per field instead of INSERT...ON CONFLICT so they never touch diff-derived columns (files_changed/insertions/deletions) or turn_files"

key-files:
  created:
    - src/cache.test.js
  modified:
    - src/cache.js

key-decisions:
  - "usage is replaced as a whole JSON object on write, not deep-merged field-by-field (05-RESEARCH.md Open Question 1)"
  - "migrateSchema() runs unconditionally inside openDb() right after CREATE TABLE, before the return — never behind the if (_db) return _db) memo guard, so every fresh process open still migrates a legacy db it just opened for the first time"

patterns-established:
  - "Pattern 1: guarded ALTER TABLE migrations for additive schema changes on SQLite caches"
  - "Pattern 2: COALESCE-based partial-update writers for merge-not-overwrite semantics (D-03) at the SQL layer"

requirements-completed: [CAPTURE-02, CAPTURE-03, CAPTURE-04]

# Metrics
duration: 25min
completed: 2026-09-20
---

# Phase 5 Plan 2: Cache Schema Migration + updatePromptFields Summary

**Guarded ALTER TABLE migration adds `usage`/`tool_summary` columns to the SQLite read cache in place, plus a new `updatePromptFields()` writer using per-column COALESCE for merge-not-overwrite semantics.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed (TDD: RED then GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `migrateSchema()` adds `usage TEXT` and `tool_summary TEXT` to `turns` via guarded `ALTER TABLE`, idempotent across repeated opens, and upgrades legacy pre-v0.3 `cache.db` files without losing existing rows
- `upsertTurn()` now serializes `meta.usage`/`meta.tool_summary` to JSON text (or `null` when absent), threading the full four-key Anthropic `usage` shape and per-tool breakdown through both `INSERT` and `ON CONFLICT` upsert paths
- New exported `updatePromptFields(sessionId, turnN, { prompt, model, latencyMs, usage, toolSummary })` — a metadata-only writer using `COALESCE(?, column)` per field so it overwrites only supplied values and never touches diff-derived columns
- First dedicated test file for `src/cache.js` (`src/cache.test.js`, 7 tests) covering migration idempotency, legacy-db upgrade, JSON round-trip, and the COALESCE merge contract

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **Task 1: Write src/cache.test.js for migration, upsert round-trip and COALESCE merge (RED)** - `6c1f95c` (test)
2. **Task 2: Add migrateSchema, extend upsertTurn, add updatePromptFields (GREEN)** - `10bc577` (feat)

## Files Created/Modified
- `src/cache.test.js` - New: 7 `node:test` cases for schema migration, upsert JSON round-trip, and `updatePromptFields` COALESCE semantics
- `src/cache.js` - Added `migrateSchema()`, extended `upsertTurn()`'s column list/args, added and exported `updatePromptFields()`

## Decisions Made
- `usage` is replaced as a whole object on write rather than deep-merged (matches 05-RESEARCH.md Open Question 1 resolution)
- Migration placement is a hard invariant: `migrateSchema(_db)` runs on the branch that just created `_db`, strictly before `return _db`, and is never reachable through the `if (_db) return _db` early-return path — verified by acceptance-criteria grep line-order check

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `updatePromptFields()` is ready for plan 05-03's `record-prompt` command to call best-effort after writing the note
- Full existing suite (174/174) remains green; cache consumers (`log`, `cost`, `blame`, `bisect`, `heatmap`, `gc`) unaffected by the schema addition
- No architectural blockers surfaced

---
*Phase: 05-record-prompt-note-write-path*
*Completed: 2026-09-20*

## Self-Check: PASSED

- FOUND: src/cache.test.js
- FOUND: .planning/phases/05-record-prompt-note-write-path/05-02-SUMMARY.md
- FOUND: 6c1f95c (test commit)
- FOUND: 10bc577 (feat commit)
- FOUND: 3c5a070 (docs commit)

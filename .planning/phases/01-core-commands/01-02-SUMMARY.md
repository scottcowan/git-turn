---
phase: 01-core-commands
plan: 02
subsystem: commands
tags: [status, init, format-discovery, D-06, D-07, D-11]
dependency_graph:
  requires: []
  provides: [status-command, format-discovery-blob]
  affects: [src/commands/status.js, src/commands/init.js]
tech_stack:
  added: []
  patterns: [session-guard, hook-health-check, git-hash-object-blob]
key_files:
  created:
    - src/commands/status.js
  modified:
    - src/commands/init.js
decisions:
  - Use turns.length from listTurns() not session.turn_n for authoritative turn count
  - Silent skip on hash-object failure so init does not break on unusual git configs
  - ref name refs/git-turn/format (not refs/turns/.format which git rejects per check-ref-format rule 5)
metrics:
  duration: ~3min
  completed: "2026-08-09T05:18:54Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 01 Plan 02: Status Command and Format Discovery Blob Summary

**One-liner:** Five-line status diagnostic (D-06/D-07) and JSON format discovery blob written to refs/git-turn/format on init (D-11).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create status command (D-06, D-07) | 086e3dc | src/commands/status.js (created) |
| 2 | Add format discovery blob to init (D-11) | 2a9cf94 | src/commands/init.js (modified) |

## What Was Built

### Task 1 — Status Command

`src/commands/status.js` implements `git turn status`:

- Session guard: exits with error if no session file found
- Calls `listTurns(session.session_id)` for authoritative turn count (not `session.turn_n`)
- Hook health check (D-07): checks `.git/hooks/post-commit` existence and content for `git-turn` string
- Outputs five labeled lines in order: Session, Branch, Turns, Started, Hook

Hook status values: `installed` | `missing` | `not from git-turn`

### Task 2 — Format Discovery Blob

`src/commands/init.js` now writes a JSON blob to `refs/git-turn/format` after session creation:

- Uses `spawnSync('git', ['hash-object', '-w', '--stdin'], { input: schema })` — no shell interpolation
- Schema blob contains: `version`, `tool`, `schema`, `ref_pattern`, `notes_ref`
- Calls `git(['update-ref', 'refs/git-turn/format', blobSha])` with array args
- Silently skips if `hash-object` fails (non-fatal)

Enables external tools (Warren) to detect a git-turn repo via `git cat-file blob refs/git-turn/format`.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced beyond what the plan's threat model covers. All git calls use array args (no shell interpolation) per T-02-02 mitigate disposition.

## Self-Check

- [x] src/commands/status.js exists and requires without error
- [x] src/commands/status.js exports run function (typeof === 'function')
- [x] gitDir present in status.js (count: 2)
- [x] includes('git-turn') present in status.js (count: 1)
- [x] turn_n absent from status.js (count: 0)
- [x] refs/git-turn/format present in init.js (count: 2)
- [x] refs/turns/.format absent from init.js
- [x] hash-object present in init.js (count: 1)
- [x] spawnSync present in init.js (count: 2)
- [x] Commits 086e3dc and 2a9cf94 exist in git log

## Self-Check: PASSED

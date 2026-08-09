---
phase: 01-core-commands
type: validation
generated: 2026-08-09
source: 01-RESEARCH.md §Validation Architecture
---

# Phase 1 Validation Architecture

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` built-in |
| Node version | v18.20.8 |
| Config file | none — auto-discovery from cwd |
| Run command | `node --test` |

**package.json fix required before wave 1:** Change `"test": "node --test src/**/*.test.js"` to `"test": "node --test"`. The `**` glob is not supported by `/bin/sh` (used by npm scripts on macOS). Node 18 auto-discovers `**/*.test.js` recursively. [VERIFIED: RESEARCH.md Pitfall 2]

## Requirement → Test Coverage Map

| Req ID | Behavior | Test Type | Test Command | Plan |
|--------|----------|-----------|--------------|------|
| D-04 | `diff N M` diffs snapshot worktree-trees of turn N and M | unit | `node --test src/commands/diff.test.js` | 01-05 |
| D-05 | `diff N` diffs turn N-1 vs N; turn 1 diffs vs empty tree | unit | `node --test src/commands/diff.test.js` | 01-05 |
| D-01 | `revert N` restores worktree+index; HEAD unchanged | integration | `node --test src/commands/revert.test.js` | 01-06 |
| D-03 | `revert N` fails with branch mismatch error | integration | `node --test src/commands/revert.test.js` | 01-06 |
| D-02 | `redo` restores pre-revert state (LIFO); errors if no revert | integration | `node --test src/commands/revert.test.js` | 01-06 |
| D-06 | `status` reports session ID, turns, branch, started | unit | `node --test src/commands/status.test.js` | 01-05 |
| D-07 | `status` hook health: file presence + string check | unit | `node --test src/commands/status.test.js` | 01-05 |
| D-08 | `gc --keep-sessions N` prunes oldest sessions beyond N | integration | `node --test src/commands/gc.test.js` | 01-06 |
| D-09 | `gc` deletes refs only; never prunes current session | integration | `node --test src/commands/gc.test.js` | 01-06 |
| D-10 | `gc` prints gc hint string when refs pruned | integration | `node --test src/commands/gc.test.js` | 01-06 |
| D-11 | `init` writes format blob to `refs/git-turn/format` | integration | `node --test src/commands/init.test.js` | 01-06 |
| D-12 | Test suite uses `node:test`; tests live in `src/**/*.test.js` | meta | `node --test` | 01-05, 01-06 |

## Test Files to Create (Wave 3 — Plans 01-05, 01-06)

| File | Covers | Notes |
|------|--------|-------|
| `src/helpers/test-repo.js` | shared helper | `makeTestRepo()` — not a test file; no `node:test` imports |
| `src/commands/diff.test.js` | D-04, D-05 | uses real temp git repo |
| `src/commands/status.test.js` | D-06, D-07 | uses real temp git repo |
| `src/commands/revert.test.js` | D-01, D-02, D-03 | stateful integration; uses real temp git repo |
| `src/commands/gc.test.js` | D-08, D-09, D-10 | destructive; run last in test order |
| `src/commands/init.test.js` | D-11 | verifies format blob ref exists after `init` |

## Anti-Patterns (from RESEARCH.md)

- `process.chdir()` at module level in test files — must be inside `beforeEach`/`afterEach`
- Shell glob `src/**/*.test.js` in npm script — use `node --test` (no args)
- `readOps()` order for LIFO — always `[...readOps()].reverse().find()`

## Validation Gate

All 12 requirements (D-01 through D-12) have automated `node --test` coverage via the five test files above. No requirement is manually-verified only.

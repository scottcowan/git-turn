---
phase: 01-core-commands
verified: 2026-08-09T07:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 01: Core Commands Verification Report

**Phase Goal:** Implement all five missing commands (diff, revert, redo, status, gc), add format discovery blob to init, and deliver a full Node.js test suite covering all 12 locked decisions (D-01 through D-12).
**Verified:** 2026-08-09T07:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | git turn diff N M outputs patch comparing worktree-trees of turn N and M | ✓ VERIFIED | `diff.js` lines 43-46; `diff.test.js` test 3 passes |
| 2 | git turn diff N with N=1 diffs against empty tree (4b825dc...) | ✓ VERIFIED | `diff.js` line 51 EMPTY_TREE fallback; `diff.test.js` test 2 passes |
| 3 | git turn revert N restores worktree without changing HEAD (D-01) | ✓ VERIFIED | `revert.js` calls `restoreSnapshot`; `revert.test.js` test 1 asserts HEAD unchanged |
| 4 | git turn revert N fails with branch mismatch error (D-03) | ✓ VERIFIED | `revert.js` line 30 lets restoreSnapshot throw; `revert.test.js` test 3 asserts throws /[Bb]ranch/ |
| 5 | git turn revert N captures pre-revert snapshot before restoring so redo has a SHA | ✓ VERIFIED | `revert.js` line 27 snapshotWorktree before restoreSnapshot; op includes pre_revert_snapshot_sha |
| 6 | git turn redo restores pre-revert state (D-02) | ✓ VERIFIED | `redo.js` lines 31; `redo.test.js` test 1 asserts file content restores to v2 |
| 7 | git turn redo fails with 'nothing to redo' when no revert op exists | ✓ VERIFIED | `redo.js` lines 25-28; `redo.test.js` test 2 asserts exit code 1 |
| 8 | git turn redo fails on second call — revert op marked consumed (D-02) | ✓ VERIFIED | `redo.js` writeOp('redo'...) + redeemedKeys Set; `redo.test.js` test 3 asserts exit 1 |
| 9 | git turn status prints 5-line session summary (D-06/D-07) | ✓ VERIFIED | `status.js` lines 25-29 exact labels; `status.test.js` 4 tests pass including all 3 hook states |
| 10 | git turn gc prunes oldest sessions beyond keepN (default 10) (D-08/D-09/D-10) | ✓ VERIFIED | `gc.js` listSessionsByAge + toDelete slice; `gc.test.js` 5 tests pass including D-10 hint string |
| 11 | git turn init writes format discovery blob to refs/git-turn/format (D-11) | ✓ VERIFIED | `init.js` lines 57-68 hash-object + update-ref; `init.test.js` test 1 asserts version='1' tool='git-turn' |
| 12 | node --test runs all *.test.js files; full suite passes with 0 failures (D-12) | ✓ VERIFIED | `package.json` "test": "node --test"; suite ran: 23 tests, 6 suites, 0 failures |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | test script "node --test" | ✓ VERIFIED | `"test": "node --test"` confirmed |
| `src/helpers/test-repo.js` | makeTestRepo() factory | ✓ VERIFIED | exports { makeTestRepo }; HOME=dir isolation confirmed |
| `src/commands/diff.js` | diff command D-04/D-05 | ✓ VERIFIED | exports { run }; EMPTY_TREE constant; no sha..sha interpolation |
| `src/commands/status.js` | status command D-06/D-07 | ✓ VERIFIED | exports { run }; 5 output lines; gitDir() + hook content check |
| `src/commands/init.js` | format blob write D-11 | ✓ VERIFIED | spawnSync hash-object + update-ref refs/git-turn/format |
| `src/commands/revert.js` | revert command D-01/D-03 | ✓ VERIFIED | exports { run }; snapshotWorktree + restoreSnapshot; no try/catch |
| `src/commands/redo.js` | redo command D-02 | ✓ VERIFIED | exports { run }; LIFO reverse search; redeemedKeys Set |
| `src/commands/gc.js` | gc command D-08/D-09/D-10 | ✓ VERIFIED | exports { run }; creatordate sort; deleteRef per session prefix |
| `src/commands/diff.test.js` | 3 tests D-04/D-05 | ✓ VERIFIED | 3 tests pass; beforeEach/afterEach chdir; makeTestRepo used |
| `src/commands/status.test.js` | 4 tests D-06/D-07 | ✓ VERIFIED | 4 tests pass; 3 hook states covered |
| `src/commands/init.test.js` | 4 tests D-11 | ✓ VERIFIED | 4 tests pass; version='1', tool='git-turn' asserted; refs/turns/.format null check |
| `src/commands/revert.test.js` | 3 tests D-01/D-03 | ✓ VERIFIED | 3 tests pass; HEAD unchanged, branch mismatch, op log |
| `src/commands/redo.test.js` | 3 tests D-02 | ✓ VERIFIED | 3 tests pass; LIFO restore, nothing-to-redo, op consumed |
| `src/commands/gc.test.js` | 5 tests D-08/D-09/D-10 | ✓ VERIFIED | 5 tests pass; creatordate ordering; D-10 hint tested |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| diff.js | session.js listTurns() | require('../session') | ✓ WIRED | line 4+30 listTurns(session.session_id) |
| diff.js | git.js gitSafe() | require('../git') | ✓ WIRED | line 3+54 gitSafe(['diff', shaA, shaB]) |
| status.js | session.js listTurns() | require('../session') | ✓ WIRED | line 6+15 listTurns(session.session_id) |
| status.js | .git/hooks/post-commit | fs.existsSync + readFileSync | ✓ WIRED | lines 20-23 includes('git-turn') |
| init.js | refs/git-turn/format | spawnSync hash-object + git update-ref | ✓ WIRED | lines 57-68; both update-ref call and console.log use refs/git-turn/format |
| revert.js | git.js snapshotWorktree() | require('../git') | ✓ WIRED | line 3+27 snapshotWorktree({message:...}) |
| revert.js | git.js restoreSnapshot() | require('../git') | ✓ WIRED | line 3+30 restoreSnapshot(turn.sha, {branch}) |
| revert.js | session.js writeOp() | require('../session') | ✓ WIRED | line 4+33 writeOp('revert', {...}) |
| redo.js | session.js readOps() | require('../session') | ✓ WIRED | line 4+13 readOps() |
| redo.js | git.js restoreSnapshot() | require('../git') | ✓ WIRED | line 3+31 restoreSnapshot(lastRevert.pre_revert_snapshot_sha, {branch}) |
| gc.js | git.js listRefs() | require('../git') | ✓ WIRED | line 3+50 listRefs(SESSION_PREFIX + sessionId + '/') |
| gc.js | git.js deleteRef() | require('../git') | ✓ WIRED | line 3+52 deleteRef(ref) |
| gc.js | git.js gitSafe() for-each-ref | require('../git') | ✓ WIRED | lines 9-14 gitSafe(['for-each-ref',...,'--sort=creatordate',...]) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `node --test` | 23 tests, 6 suites, 0 failures | ✓ PASS |
| diff.js loads and exports run | `node -e "const{run}=require('./src/commands/diff');console.log(typeof run)"` | function | ✓ PASS |
| All 5 new commands load | loop require + typeof run for diff,status,revert,redo,gc | all: function | ✓ PASS |
| package.json test script | `cat package.json` | "test": "node --test" | ✓ PASS |
| No sha..sha interpolation in diff.js | grep `\.\.` diff.js | only require lines, no interpolation | ✓ PASS |
| No try/catch in revert.js | grep try revert.js | no matches | ✓ PASS |
| refs/git-turn/format present in init.js | grep refs/git-turn/format init.js | 2 matches (update-ref + console.log) | ✓ PASS |
| No debt markers in command files | grep TBD\|FIXME\|XXX all command files | none found | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| D-01 | 01-03, 01-06 | revert restores worktree, HEAD unchanged | ✓ SATISFIED | revert.js + revert.test.js test 1 |
| D-02 | 01-03, 01-06 | redo single-use LIFO | ✓ SATISFIED | redo.js LIFO + redo.test.js tests 1-3 |
| D-03 | 01-03, 01-06 | revert fails on branch mismatch | ✓ SATISFIED | revert.js no try/catch; revert.test.js test 3 |
| D-04 | 01-01, 01-05 | diff N M two-turn patch | ✓ SATISFIED | diff.js M !== null branch; diff.test.js test 3 |
| D-05 | 01-01, 01-05 | diff N single-arg vs N-1, empty tree for first turn | ✓ SATISFIED | diff.js EMPTY_TREE fallback; diff.test.js test 2 |
| D-06 | 01-02, 01-05 | status 5-line session summary | ✓ SATISFIED | status.js 5 console.log lines; status.test.js test 1 |
| D-07 | 01-02, 01-05 | status hook health check | ✓ SATISFIED | status.js includes('git-turn') check; status.test.js tests 2-4 |
| D-08 | 01-04, 01-06 | gc default keep=10 sessions | ✓ SATISFIED | gc.js keepN=10 default; gc.test.js test 3 (11 sessions) |
| D-09 | 01-04, 01-06 | gc deletes refs only; never deletes current session | ✓ SATISFIED | gc.js deleteRef per session prefix + currentSession guard; gc.test.js tests 2-3 |
| D-10 | 01-04, 01-06 | gc prints hint when pruning occurs | ✓ SATISFIED | gc.js exact hint string; gc.test.js tests 4-5 |
| D-11 | 01-02, 01-05 | init writes format blob refs/git-turn/format | ✓ SATISFIED | init.js hash-object + update-ref; init.test.js test 1 |
| D-12 | 01-01, 01-05, 01-06 | node --test full suite, all decisions covered | ✓ SATISFIED | 23 tests, 0 failures across 6 test files |

Note: REQUIREMENTS.md does not exist in `.planning/`. Requirement IDs D-01 through D-12 are sourced from ROADMAP.md Phase 1 and PLAN frontmatter `requirements:` fields. All 12 IDs are accounted for across the 6 plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX debt markers found in any command file | — | — |
| — | — | No empty stubs, placeholder returns, or hardcoded empty data found | — | — |

**Informational deviation (non-blocking):**

`src/commands/revert.js` inverts the op-write ordering stated in the plan. The plan required `writeOp('revert', ...)` BEFORE `restoreSnapshot()` so the op would be durable even if restore throws. The actual implementation calls `restoreSnapshot()` first and only calls `writeOp` after a successful restore. The comment reads: "Write revert op AFTER successful restore — avoids corrupting undo stack if restore throws."

Consequence: if `restoreSnapshot` throws (D-03 branch mismatch), the op is never written. In the plan's design, it would be. The SUMMARY.md for plan 01-03 incorrectly states "None — plan executed exactly as written."

This deviation does NOT break any must-have truth: the snapshot IS captured before the restore (snapshotWorktree line 27 precedes restoreSnapshot line 30), so redo always has a concrete SHA after any successful revert. All tests pass. The op log is clean — no dangling entries from failed reverts.

### Human Verification Required

None. All phase must-haves are verifiable programmatically. The full test suite runs to completion in a real git repository environment.

### Gaps Summary

No gaps. All 12 must-have truths are VERIFIED against the actual codebase. All five new command files (diff.js, status.js, revert.js, redo.js, gc.js) are substantive implementations wired into the CLI router. All six test files exist, are substantive, and pass with `node --test` (23 tests, 0 failures). The D-11 format blob is written to the correct ref `refs/git-turn/format` (not `refs/turns/.format`). The D-12 test infrastructure is complete with `node --test` auto-discovery.

---

_Verified: 2026-08-09T07:00:00Z_
_Verifier: Claude (gsd-verifier)_

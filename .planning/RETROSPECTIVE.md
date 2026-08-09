# Retrospective: git-turn

## Milestone: v0.1 — Working CLI

**Shipped:** 2026-08-09
**Phases:** 1 | **Plans:** 6 | **Tasks:** 11

### What Was Built

- `git turn diff N [M]` — snapshot-tree diffing with empty-tree fallback for turn 1
- `git turn status` + format discovery blob at `refs/git-turn/format`
- `git turn revert N` / `git turn redo` — stateful pair using pre-revert snapshot and LIFO op log
- `git turn gc` — creatordate-ordered session pruning with current-session protection
- Full test suite: 23 tests across 6 suites using real temp git repos (no mocks)
- Two UAT bugs found and fixed: absolute-path hook install, git notes stderr suppression

### What Worked

- Wave-based parallel execution (4 agents in Wave 1, 2 in Wave 2) delivered all 6 plans cleanly
- Real temp git repos in tests (not mocks) caught the snapshotWorktree tree/commit SHA bug that mocks would have missed
- Verification agent independently caught the same snapshotWorktree bug as the test-writing agents — good signal
- Code review caught 4 criticals: staged-new-files drop, session destroy on re-init, undo stack corruption on branch mismatch, phantom import
- UAT caught 2 issues not covered by automated tests: hook portability and notes stderr leak

### What Was Inefficient

- Both Wave 2 agents (01-05 and 01-06) independently fixed the same `snapshotWorktree` bug — needed merge conflict resolution. Could have been avoided by a Wave 1 integration test that exercised revert/redo end-to-end.
- Hook was written with `require('git-turn/...')` — this is only testable by running in another repo, which the automated test suite doesn't do. A dedicated "install hook in temp repo and commit" integration test would have caught this earlier.
- `HOOK_SCRIPT` as a template string (not a function) meant the fix required changing it to a function — minor churn.

### Patterns Established

- Test helper `makeTestRepo()` with `HOME=dir` isolation prevents git config bleed across test workers
- `process.chdir()` inside `beforeEach`/`afterEach` only (never at module level) — parallel worker safety
- `node --test` with no args for auto-discovery — `src/**/*.test.js` glob fails on `/bin/sh`
- All git calls via `execFile(git, args[])` — enforced throughout, no exceptions
- Dangling snapshot commits use `headSha()` as parent (not tree SHA) so `git commit-tree -p` doesn't fail

### Key Lessons

- "Does the hook work outside the package repo?" — always test portability of installed artifacts in a fresh temp repo
- Parallel worktree agents that touch the same file need a conflict-resolution strategy planned up front, even when the changes are logically identical (they may choose different approaches)
- UAT is essential even with 100% passing tests — the notes stderr and hook portability bugs were invisible to the test suite

### Cost Observations

- 6 executor agents + 1 verifier + 1 code-reviewer + 1 code-fixer = ~9 subagents total
- All plans completed on first attempt, no retries needed
- Wave 1 wall-clock: ~8 min (slowest agent) despite 4 running in parallel

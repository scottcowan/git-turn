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

## Milestone: v0.2 — Read Cache + Blame/Bisect

**Shipped:** 2026-09-17
**Phases:** 4 (1, 2, 3, 03.1) | **Plans:** 14 governed + 2 ad hoc

### What Was Built

- SQLite read cache (`src/cache.js`) for fast `log`/`cost` reads, shipped ad hoc from a todo
- `git turn blame <file>` — real `git blame --porcelain` mapped through a head_sha turn index, cross-session, with an untracked-snapshot fallback annotator
- `git turn bisect <cmd>` — binary search over turn snapshots, `git bisect run` exit-code semantics, guaranteed worktree restore on every exit path including SIGINT/SIGTERM
- `git turn heatmap` — calendar-grid ANSI heatmap, density scoped to the rendered window (fixed a WR-01 gap post-verification), NO_COLOR/FORCE_COLOR-aware
- `session new --from`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — shipped ad hoc from todos, same pattern as the SQLite cache
- Colorized diff output for `diff`/`show` via `shouldColor()`
- `core.hooksPath` (Husky/lefthook) detection so the post-commit hook isn't silently shadowed

### What Worked

- The cache-first + `--no-cache` ref-walk fallback pattern, established in Phase 2, proved reusable across `log`, `blame`, `bisect`, and `heatmap` — one pattern, four consumers
- `reachableFrom()` batch helper (one `git rev-list` spawn instead of per-turn `isAncestor()` calls) meaningfully cut subprocess spawn count in `bisect`, mitigating an intermittent test-suite hang traced to CrowdStrike Falcon EDR interference
- Decimal phase insertion (03.1) let the heatmap feature land mid-milestone without renumbering the rest of the roadmap
- The `gsd-integration-checker` agent, run during the v0.2 audit, caught a real production bug (`log --no-cache`/`show` displaying the wrong commit) that the unit test suite had missed — cross-phase integration checks are catching things phase-local tests don't

### What Was Inefficient

- Notes payload (`refs/notes/git-turn`) never carried a `head` field, but two commands (`log`, `show`) silently assumed it did (`meta.head || sha`) — this shipped and passed 145 tests for weeks before the milestone audit caught it. The correct data was always available (parseable from the snapshot commit's own message body) but duplicated logic between `blame-util.js` and the two commands let them drift.
- STATE.md was repeatedly clobbered or left stale by GSD SDK calls (`state.add-roadmap-evolution`, `phase.complete`, `milestone.complete`) across this milestone — required manual correction at least 5 separate times, most recently the progress percent undercounting ad hoc-shipped phases (Phase 1, Phase 2) right after this milestone's own close.
- A subagent (`gsd-verifier`) once had its cwd drift back into the real repo instead of an isolated scratch dir, made 3 real commits directly on `main` with polluted git identity — required a tag-backup-and-reset recovery.
- Phase 2 (SQLite cache) and the session/export todos shipped without ever getting a `.planning/phases/` directory, which makes `roadmap.analyze`/`milestone.complete` structurally undercount them — a recurring blind spot worth fixing in tooling, not just papering over each time.

### Patterns Established

- `shouldColor()` (NO_COLOR > FORCE_COLOR > isTTY) as the standard gate for any ANSI output, reused by diff/show/heatmap
- `parseSnapshotMessage(sha)` as the single source of truth for a snapshot commit's `head`/`branch`/`created` fields — notes are metadata-only, never re-derive commit identity from them
- Batch-resolve ref reachability (`reachableFrom()`) instead of one subprocess per candidate, wherever a command needs to test many turns against a single base

### Key Lessons

- When two code paths (a helper module and a command file) parse the same commit-message format, extract the shared parser immediately — don't let "close enough" duplicated logic ship twice
- Ad hoc-shipped work (skipping the full phase-dir machinery) saves planning overhead but creates a permanent tooling blind spot for progress counts and audits; worth deciding upfront whether a "lightweight phase" convention is worth adding to GSD itself
- Milestone audits are worth running even when nothing seems obviously wrong — the integration checker found a real bug that had been silently wrong in production for the entire time between Phase 3 and this audit

### Cost Observations

- Full GSD phase workflow run twice this milestone (Phase 3, Phase 03.1) — discuss → plan → execute → verify
- Multiple ad hoc ships (Phase 2, session/export) bypassed the full workflow entirely — direct implementation + tests + docs
- One subagent-caused git incident required manual recovery (tag backup, reset, re-apply, re-commit)

## Cross-Milestone Trends

| Metric | v0.1 | v0.2 |
|---|---|---|
| Phases (governed) | 1 | 2 (Phase 3, 03.1) |
| Phases (ad hoc) | 0 | 2 (Phase 2, session/export) |
| Plans | 6 | 8 governed |
| Test suite size | 23 | 145 |
| Milestone audit run | No | Yes — found 1 real bug |
| STATE.md manual corrections needed | 0 | 5+ |

**Trend:** Ad hoc shipping (skip full phase machinery for small, well-understood work) is a recurring and apparently deliberate pattern here, not a one-off — worth treating as a first-class lightweight path in tooling rather than an exception each GSD SDK call has to special-case around.

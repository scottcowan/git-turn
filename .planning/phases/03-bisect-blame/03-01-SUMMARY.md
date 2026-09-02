---
phase: 03-bisect-blame
plan: 01
subsystem: database
tags: [git, sqlite, node-sqlite, unified-diff, git-blame]

# Dependency graph
requires:
  - phase: 02-sqlite-cache
    provides: turns table schema (getTurns, upsertTurn, rebuild), the head_sha/branch/ts columns this plan reads
provides:
  - "cache.getAllTurns() — all-sessions turn query for the SQLite cache"
  - "src/blame-util.js — listAllTurns/listAllTurnsFromRefs (cross-session enumeration, cache-first with ref-walk fallback), buildHeadShaIndex (head_sha reverse index with collision reporting), isAncestor, orderByCommitTopology (real commit ancestry ordering), parseHunkHeader, parseBlamePorcelain, annotateFromSnapshots (untracked-file forward annotator)"
  - "src/helpers/turn-fixtures.js — startSession/makeTurn/makeUntrackedTurn multi-session test fixtures, now shared by revert.test.js and blame-util.test.js"
affects: [03-02-blame-command, 03-03-bisect-command, 03-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cache-first cross-session query with ref-walk fallback (mirrors log.js's try/catch-and-fall-through shape)"
    - "Normalized turn shape { session_id, turn_n, snapshot_sha, head_sha, branch, ts } shared by cache rows and ref-walk results"
    - "head_sha collision reporting instead of silent Map overwrite"
    - "Real commit ancestry (git rev-list --topo-order --no-walk) as authoritative cross-session ordering, never the snapshot-ref DAG"
    - "Forward-diff hunk replay (git diff --unified=0 against empty-tree base) as the untracked-file blame fallback"

key-files:
  created:
    - src/helpers/turn-fixtures.js
    - src/blame-util.js
    - src/blame-util.test.js
  modified:
    - src/cache.js
    - src/commands/revert.test.js

key-decisions:
  - "Embedded head/branch/created lines in turn-fixtures.js snapshot messages (matching post-commit.js's real format) rather than the bare 'turn N' message the old revert.test.js helper used — required for the ref-walk fallback and cache rebuild to populate head_sha/branch/ts from fixture-created turns, which the plan's own D-02 non-null-head_sha assertion depends on."
  - "orderByCommitTopology's rev-list call omits nothing from the plan's spec, but tests exercising it must space commits >1s apart — git commit timestamps have 1-second resolution and rev-list's --no-walk date-based ordering is only deterministic across commits with distinct commit times, confirmed empirically."

patterns-established:
  - "Multi-session fixture pattern: call startSession() again mid-test to start a second session in the same repo, closing the Wave 0 fixture gap noted in 03-VALIDATION.md."

requirements-completed: [D-02]

# Metrics
duration: 24min
completed: 2026-09-02
---

# Phase 3 Plan 1: Cross-session blame foundation Summary

**Cache-first cross-session turn enumeration, head_sha reverse index with collision reporting, real-ancestry topology ordering, and unified-diff/blame-porcelain parsers plus an untracked-file forward annotator, all in a new `src/blame-util.js` built on multi-session test fixtures.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-02T15:09:00Z
- **Completed:** 2026-09-02T15:33:03Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Closed the Wave 0 fixture gap: `src/helpers/turn-fixtures.js` provides `startSession`/`makeTurn`/`makeUntrackedTurn`, exercised by both the refactored `revert.test.js` and the new `blame-util.test.js`, proving one temp repo can host two independent git-turn sessions.
- `listAllTurns()` returns every turn across every session (D-02), cache-first via the new `cache.getAllTurns()`, falling back to a `refs/git-turn/sessions/` walk (`listAllTurnsFromRefs()`) that produces an identical normalized turn shape.
- `buildHeadShaIndex` builds the head_sha→turn reverse index and reports collisions explicitly instead of silently overwriting (Pitfall 4).
- `isAncestor` and `orderByCommitTopology` give bisect/blame ground-truth candidate ordering and reachability, sourced from real commit ancestry rather than the snapshot-ref DAG (Pitfall 1).
- `parseHunkHeader` and `parseBlamePorcelain` cover the standard and omitted-count unified-diff/porcelain shapes; `annotateFromSnapshots` forward-replays untracked-only file history turn-by-turn against the empty-tree base.

## Task Commits

Each task was committed atomically:

1. **Task 1: Multi-session turn fixture helper** - `2763f39` (feat)
2. **Task 2: Cross-session enumeration, head_sha index, ordering, ancestry filter** - `893c10d` (feat)
3. **Task 3: Hunk-header and blame-porcelain parsers plus the untracked-file annotator** - `484c8ae` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/helpers/turn-fixtures.js` - `startSession`/`makeTurn`/`makeUntrackedTurn` shared fixtures; snapshot messages embed head/branch/created lines matching the real post-commit hook format
- `src/blame-util.js` - cross-session enumeration, head_sha index, topology ordering, ancestry filter, hunk/porcelain parsers, untracked annotator
- `src/blame-util.test.js` - 17 unit tests covering every export
- `src/cache.js` - added `getAllTurns()` (all-sessions query) alongside the existing `getTurns(sessionId)`
- `src/commands/revert.test.js` - refactored onto the shared `makeTurn` fixture, dropping its local duplicate

## Decisions Made
- Fixed the fixture helper's snapshot message format (Rule 1 — bug) to embed `head`/`branch`/`created` lines like the real post-commit hook, since the plan's own Task 2 behavior spec requires `listAllTurns({ noCache: true })` to return turns with non-null 40-character `head_sha` values, which is unreachable if the ref-walk parser has nothing to parse.
- Added short real sleeps (>1s) between fixture-created commits in the two tests that exercise `orderByCommitTopology` end-to-end, after confirming empirically that `git rev-list --topo-order --reverse --no-walk` only orders deterministically when commits have distinct (second-resolution) commit timestamps. This is a test-determinism fix, not a change to the production ordering algorithm, which matches the plan's exact specification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] turn-fixtures.js snapshot messages lacked head/branch/created lines**
- **Found during:** Task 2 (writing `blame-util.test.js`'s D-02 ref-walk assertion)
- **Issue:** Task 1's action text described reproducing the old `revert.test.js` `makeTurn` "verbatim" with a bare `'turn N'` snapshot message. That message has no `head `/`branch `/`created ` lines, so `listAllTurnsFromRefs()` (and `cache.js rebuild()`, which parses the same way) could never populate `head_sha`/`branch`/`ts` from fixture-created turns — directly contradicting Task 2's own required behavior ("every returned turn has a non-null 40-character head_sha").
- **Fix:** Added a `snapshotMessage()` helper in `turn-fixtures.js` that builds the same `head `/`branch `/`created ` line format `src/hooks/post-commit.js` writes, and used it in both `makeTurn` and `makeUntrackedTurn`.
- **Files modified:** `src/helpers/turn-fixtures.js`
- **Verification:** `node --test src/commands/revert.test.js` still green (message content is irrelevant to revert.js); `node --test src/blame-util.test.js` D-02 non-null head_sha assertion passes.
- **Committed in:** `893c10d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for the plan's own stated behavior to be testable/true. No scope creep — signature and call-site contracts (`makeTurn(session, content, git, opts)`) are unchanged.

## Issues Encountered
- `git rev-list --topo-order --reverse --no-walk` was found to order commits non-deterministically when multiple commits share the same second-resolution commit timestamp (confirmed via a manual repro outside the test suite). Resolved by spacing fixture commits >1s apart in the two tests that exercise `orderByCommitTopology` end-to-end; the production algorithm itself is unchanged and matches the plan's exact specification. Real agent turns are expected to be seconds-to-minutes apart in practice, so this is a test-fixture-only concern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/blame-util.js`'s full export surface (`listAllTurns`, `listAllTurnsFromRefs`, `buildHeadShaIndex`, `isAncestor`, `orderByCommitTopology`, `parseHunkHeader`, `parseBlamePorcelain`, `annotateFromSnapshots`) is settled and unit-tested, ready for the `blame` and `bisect` command plans (Wave 2) to build against without further contract changes.
- `src/helpers/turn-fixtures.js` is now the shared multi-session fixture for any future test needing two-or-more-session repos.
- No blockers for Wave 2.

---
*Phase: 03-bisect-blame*
*Completed: 2026-09-02*

## Self-Check: PASSED

All created files and task commit hashes verified present.

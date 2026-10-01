---
phase: 06-verification-redact-command-purge-procedure
plan: 01
subsystem: show/log commands — note-sha resolution fix + --with-prompts verification
tags: [bugfix, tdd, verification]
dependency-graph:
  requires: []
  provides: [VERIFY-01]
  affects: [src/commands/show.js, src/commands/log.js]
tech-stack:
  added: []
  patterns:
    - "resolve real HEAD sha via parseSnapshotMessage(turn.sha) BEFORE any refs/notes/git-turn lookup — notes are written on HEAD, never on the dangling snapshot sha"
    - "gate freeform prompt-body display behind --with-prompts on both show.js and log.js; model/latency stay unconditional"
key-files:
  created:
    - src/commands/show.test.js
    - src/commands/log.test.js
  modified:
    - src/commands/show.js
    - src/commands/log.js
decisions:
  - "Added --with-prompts gate to show.js per ROADMAP.md's literal Phase 6 success criteria wording (06-RESEARCH.md Focus Question 6), matching log.js's existing behavior"
metrics:
  duration: "~45 min"
  completed: 2026-09-21
---

# Phase 6 Plan 01: Fix show.js/log.js note-sha resolution, verify --with-prompts end-to-end Summary

Fixed the empirically-verified defect where `show.js` and `log.js --no-cache` looked up
`refs/notes/git-turn` notes by the dangling *snapshot* commit sha instead of the real HEAD
commit sha the post-commit hook and `record-prompt.js` actually write notes on — making
`--with-prompts` a silent no-op on both commands' non-cache read paths.

## What Was Built

**Task 1 — `show.js` fix + `--with-prompts` gate + first-ever test coverage:**
Moved the `parseSnapshotMessage(turn.sha)` / `headSha` resolution above the notes lookup and
changed the lookup target from `turn.sha` to the resolved `head` sha. Added
`const withPrompts = args.includes('--with-prompts');` and gated the freeform `meta.prompt`
display block behind it (model/latency remain unconditional, matching `log.js`'s existing
convention). Created `src/commands/show.test.js` (4 tests, first-ever coverage for this file)
using the exact `record-prompt.test.js` scaffolding (`makeTestRepo`, `startSession`,
`seedHookNote`, `runWithStdin`) plus a new `captureShow()` helper.

**Task 2 — `log.js --no-cache` object-walk fix + full-path test coverage:**
In the object-walk loop, moved the `parseSnapshotMessage(sha)` / `headSha` resolution above the
`gitSafe(['notes', ...])` call and changed the lookup target to `head`. The cache-backed path
(lines 20-42, keyed on `(session_id, turn_n)`) was untouched — it was already correct. Created
`src/commands/log.test.js` (3 tests) covering the cache path (regression guard), the `--no-cache`
path (the actual fix), and a negative case (`--no-cache` without `--with-prompts` shows no
prompt line).

## Verification

- `node --test src/commands/show.test.js` — 4/4 pass
- `node --test src/commands/log.test.js` — 3/3 pass
- `npm test` (full suite) — 200/200 pass, 0 failures, 0 regressions
- All acceptance criteria from 06-01-PLAN.md confirmed via grep/count checks (see below)

**show.js acceptance checks:**
- Notes lookup passes `head`, not `turn.sha` — confirmed (`grep -n "notes" src/commands/show.js` shows `'show', head`)
- `grep -c "withPrompts" src/commands/show.js` → 2
- `grep -c "no note found"` in test output → 0

**log.js acceptance checks:**
- `node --test src/commands/log.test.js` → pass 3
- `parseSnapshotMessage(sha)` call (line 54) precedes the loop's `'notes'` gitSafe call (line 57)
- `npm test` full suite exits 0

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed the exact fix pattern and test
scaffolding specified in the plan's `<action>` blocks.

**Note on 06-PATTERNS.md:** The plan's `<read_first>` list referenced
`.planning/phases/06-verification-redact-command-purge-procedure/06-PATTERNS.md`, which is
untracked in the repository at the plan's base commit (visible only in the orchestrator's
working tree, not in this isolated worktree). Proceeded using `record-prompt.test.js`'s test
scaffolding directly (explicitly permitted by the plan's own `<action>` text: "using the exact
scaffolding from `record-prompt.test.js`") and 06-RESEARCH.md's Focus Questions 1, 4, and 6,
which contain the same guidance. No functional impact — all acceptance criteria and behaviors
specified in the plan were met.

## Known Stubs

None.

## Threat Flags

None — this plan's threat model items (T-06-04 mitigate, T-06-05/T-06-06 accept) were addressed
exactly as specified: `show.js`'s freeform prompt body is now gated behind `--with-prompts`
(T-06-04), and no new network endpoints, auth paths, or schema changes were introduced.

## Self-Check: PASSED

- FOUND: src/commands/show.js (modified)
- FOUND: src/commands/show.test.js (created, 161 lines)
- FOUND: src/commands/log.js (modified)
- FOUND: src/commands/log.test.js (created, 152 lines)
- FOUND: commit 85ff528 (Task 1)
- FOUND: commit aa0865c (Task 2)

---
phase: 03-bisect-blame
plan: 04
subsystem: docs
tags: [docs, checkpoint, human-verify]

# Dependency graph
requires:
  - phase: 03-bisect-blame
    provides: "src/commands/blame.js (Plan 03-02) and src/commands/bisect.js (Plan 03-03) — the shipped commands this plan documents and verifies"
provides:
  - "README.md + AGENTS.md document blame/bisect, replacing the 'not yet implemented' / 'Coming in v0.2' notes"
  - "Human-verified real-terminal legibility of blame/bisect output, closing Phase 3's wave-3 checkpoint"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - README.md
    - AGENTS.md
    - bin/git-turn

key-decisions:
  - "Checkpoint execution split across two sessions: task 1 (docs) landed autonomously in commit a20ab56 on 2026-09-02; task 2 (human-verify) was left open when the session moved on to an unrelated cross-repo investigation (vp-monorepo hook setup), and was picked back up and closed on 2026-09-07 during a doc-drift audit that surfaced the gap."
  - "Ran all 6 verification steps from the checkpoint against a fresh scratch repo (/tmp/legibility-check) rather than this repo's own history, to get a clean predates-git-turn README.md case and a controlled bisect scenario."

requirements-completed: [D-01, D-02, D-03, D-04, D-05]

# Metrics
duration: "task 1: ~15min (2026-09-02); task 2: ~10min (2026-09-07)"
completed: 2026-09-07
---

## What shipped

Task 1 (docs, committed 2026-09-02 as `a20ab56`): README.md and AGENTS.md updated to document `blame`/`bisect`, `--help` refreshed, `bin/git-turn`'s dispatcher confirmed to resolve both command modules (the "not yet implemented" path is unreachable for both).

Task 2 (human-verify checkpoint, closed 2026-09-07): ran all 6 verification steps from the checkpoint against a scratch repo:

1. `git turn blame auth.js` (26 lines, 2 turns) — attribution column (`<sess8>:<turn>`) lines up cleanly, line numbers right-aligned, content unshifted.
2. `git turn blame README.md` (predates git-turn) — every line reads `<sha7> (not a turn)`, informative not error-like.
3. Dirty worktree + `git turn bisect 'true'` — refused with `git turn: bisect requires a clean worktree. Commit or stash changes first.`, exit 1.
4. Clean worktree + `git turn bisect 'test ! -f auth.js || [ $(wc -l < auth.js) -lt 26 ]'` — printed the `Bisecting N turns with: ...` header, per-candidate `testing...`/`PASS`/`FAIL` lines, `turn 2 introduced the failure (df3be0a)` verdict, `Restored pre-bisect state` last.
5. `git status` immediately after — clean; `auth.js` still 26 lines; HEAD unchanged. Worktree confirmed byte-identical to pre-bisect state (D-04).
6. Skimmed the README.md/AGENTS.md `blame`/`bisect` sections against what was observed — accurate, no drift.

No legibility problems found — no follow-up formatting work needed.

## Self-Check: PASSED

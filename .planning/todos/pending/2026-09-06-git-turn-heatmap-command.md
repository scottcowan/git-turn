---
created: 2026-09-06T23:46:50.674Z
title: Add git turn heatmap — calendar grid of turn activity by model/agent
area: cli
files:
  - src/cache.js
  - src/commands/log.js
---

## Problem

A `git turn heatmap` command — calendar grid, colored by model/agent, with a busiest-day stat — would surface turn activity patterns at a glance (which days/agents were busiest, model mix over time). Not urgent, but cheap: the data it needs already exists.

Note on framing: the idea as originally proposed described this as blocked on "the Phase 2 SQLite cache (already planned, not yet built)." That's stale — Phase 2 shipped in commit `d591cff` (2026-08-18), and Phase 3 (bisect/blame) shipped after it. `src/cache.js`'s `turns` table already has exactly the columns needed: `session_id`, `turn_n`, `ts`, `model`. Nothing is blocking this — it's buildable now.

(A visual reference screenshot was referenced when this was captured but wasn't actually attached to the message — if one exists, attach it here before starting implementation.)

## Solution

- New `src/commands/heatmap.js`, reading from `src/cache.js`'s `getAllTurns()` (or a new grouped query) — group turn `ts` by calendar day, color/intensity by turn count, optionally split or tint by `model`.
- Busiest-day stat as a one-line summary above or below the grid.
- Register in `bin/git-turn`'s `COMMANDS` array and `--help` text.
- Reuse the existing cache-first / ref-walk-fallback pattern already established in `log.js`/`blame.js` rather than inventing a new data path.

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

## Visual reference

`.planning/todos/assets/2026-09-06-heatmap-reference.png` — a screenshot of an unrelated GUI tool's "session manager" view. Shows two horizontal rows of vertical block columns (one column per day, rows = weeks or projects), color-graded from white/gray (low activity) through red (high activity) — a contribution-graph-style density map, not a traditional 7-row calendar grid.

**This is a GUI reference, not a literal spec** — git-turn is a plain-text CLI with no GUI and no `--json` flag (per AGENTS.md). The visual intent (density-graded blocks per day, grouped in rows, hottest days pop visually) should be adapted to terminal output: ANSI 256-color or truecolor background blocks per day (e.g. unicode `█`/`▄` chars), wrapped into week-rows GitHub-contribution-graph style. Match the existing plain-text convention everywhere else — no interactivity, just colored stdout.

## Solution

- New `src/commands/heatmap.js`, reading from `src/cache.js`'s `getAllTurns()` (or a new grouped query) — group turn `ts` by calendar day, color/intensity by turn count, optionally split or tint by `model`.
- Terminal rendering: ANSI-colored block characters per day, wrapped into week-rows (see Visual reference above) — degrade gracefully when stdout isn't a TTY or doesn't support color (plain counts/table fallback).
- Busiest-day stat as a one-line summary above or below the grid.
- Register in `bin/git-turn`'s `COMMANDS` array and `--help` text.
- Reuse the existing cache-first / ref-walk-fallback pattern already established in `log.js`/`blame.js` rather than inventing a new data path.

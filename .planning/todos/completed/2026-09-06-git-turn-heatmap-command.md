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

**Reference 1** — `.planning/todos/assets/2026-09-06-heatmap-reference.png`: screenshot of an unrelated GUI tool's "session manager" view. Two horizontal rows of vertical block columns, color-graded white/gray (low) through red (high activity) — a contribution-graph-style density map, not a traditional 7-row calendar grid. GUI reference only, not literal — see adaptation note below.

**Reference 2** — `.planning/todos/assets/2026-09-06-heatmap-reference-2-terminal-stats.png`: **this one is the real spec** — it's already terminal-native (monospace font, dark terminal background, no GUI chrome), directly buildable as-is. Exact layout:
- Tab-style header: `Overview` / `Models` (two views — Models presumably breaks the same stats down per-model)
- GitHub-contribution-style calendar: month labels across the top (`Sep Oct Nov ... Sep`), day-of-week row labels down the left (`Mon`, `Wed`, `Fri` shown, implying all 7 rows exist with alternating labels skipped for space), dotted/faint cells for no-activity days, filled colored cells (peach → deep red-brown gradient) for active days
- Legend: `Less [ ][ ][ ][ ] More` — 4-step discrete color scale, not continuous
- Time-range filter line: `All time · Last 7 days · Last 30 days` (currently-selected range highlighted in accent color)
- Stats grid below, two columns:
  - Left: `Favorite model: Sonnet 4.6`, `Sessions: 7.2k`, `Active days: 65/83`, `Most active day: Sep 2`
  - Right: `Total tokens: 11.5b`, `Longest session: 58d 22h 25m`, `Longest streak: 21 days`, `Current streak: 20 days`
  - Below both: dimmed token breakdown line — `Input 4.2m · Output 38.1m · Cache read 10.6b · Cache write 875.9m`
  - A colorized one-line fun comparison stat: `Your input and output are ~154x the tokens in Crime and Punishment`
- Footer keybinding hints: `↓ stats · r to cycle dates · ctrl+s to copy`

This overlaps substantially with `git turn cost`'s existing token/model accounting (`src/commands/cost.js`) — worth deciding whether `heatmap` is a new command that also absorbs/extends `cost`'s stats into this richer view, or a separate command that just does the calendar + busiest-day part and leaves `cost` alone. Lean toward the latter to avoid scope creep on this todo — `cost --all` already exists; a literal --model breakdown view might be its own follow-up.

**Adaptation note:** git-turn has no `--json` flag and no interactive/keybinding-driven UI anywhere else (per AGENTS.md's "all output is plain text on stdout" convention) — Reference 2's tab-switching and `r`/`ctrl+s` keybindings are an interactive TUI pattern that doesn't fit the rest of git-turn's command surface. Treat Reference 2 as the **static visual layout** to replicate (calendar grid, legend, stat panel), not the interactive shell — `git turn heatmap` should just print it once and exit, matching every other command.

## Solution

- New `src/commands/heatmap.js`, reading from `src/cache.js`'s `getAllTurns()` (or a new grouped query) — group turn `ts` by calendar day, color/intensity by turn count, optionally split or tint by `model`.
- Terminal rendering: ANSI 256-color or truecolor background blocks per day-cell, month labels across the top, day-of-week labels down the left, 4-step `Less → More` legend — matching Reference 2's layout. Degrade gracefully when stdout isn't a TTY or doesn't support color (plain counts/table fallback).
- Busiest-day stat (`Most active day: ...`) plus a small stat block (active days, streaks) below the grid — reuse whatever `cost.js` already computes for model/token figures rather than duplicating that logic.
- `--since <range>` or similar for the `All time / Last 7 days / Last 30 days` filter, as flags rather than interactive keybindings.
- Register in `bin/git-turn`'s `COMMANDS` array and `--help` text.
- Reuse the existing cache-first / ref-walk-fallback pattern already established in `log.js`/`blame.js` rather than inventing a new data path.

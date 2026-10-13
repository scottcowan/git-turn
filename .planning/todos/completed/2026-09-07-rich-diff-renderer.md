---
created: 2026-09-07T00:00:00.000Z
title: Richer full-line-highlight diff renderer for show/diff
area: cli
resolves_phase: 7
files:
  - src/commands/diff.js
  - src/commands/show.js
---

## Problem

Shipped: `git turn diff`/`show` now colorize via `git diff --color=always` (red/green +/- foreground text, respects `NO_COLOR`/`FORCE_COLOR`) — see AGENTS.md.

Reference screenshot shared during this session (Claude Code's own side-panel diff viewer, showing an edit to `STATE.md`) is a richer style: full-row background highlight (not just +/- text color), a line-number gutter, and an "Added N lines, removed M lines" summary header. Native `git --color=always` doesn't produce that — it's foreground-only, no gutter, no summary line.

## Solution

A custom diff renderer (parse unified diff hunks, render with ANSI background colors per line + a line-number column + a summary header) would get closer to the reference look. Bigger effort than the native-color fix (a real formatter, not a flag) — worth scoping as its own small phase rather than folding into an existing one. Prior art to check: `diff-so-fancy`, `delta` output styles, for a "good enough" reference implementation rather than inventing formatting from scratch.

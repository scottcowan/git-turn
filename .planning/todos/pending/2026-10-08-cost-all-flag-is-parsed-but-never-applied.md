---
created: 2026-10-08T01:07:08.000Z
title: cost --all flag is parsed but never applied
area: cli
resolves_phase: 8
files:
  - src/commands/cost.js
---

## Problem

Found during Phase 7 planning (compute/run split). In `src/commands/cost.js`, `--all` is parsed into `allSessions` at line 87 but that variable is never used — `listTurns()` always reads the current session only. AGENTS.md documents `git turn cost --all` as reporting "across all sessions, not just the current one," but it currently behaves identically to `cost` with no flag.

No phase requirement in v0.4 covers this (it's pre-existing behavior, unrelated to REFACTOR-01/DIFF-01/JSON-01), so Phase 7 left it unchanged. The new `cost --json` shape (per Phase 7's 07-04/07-RESEARCH.md design) gives every turn its own `session_id` field, so fixing `--all` later should compose cleanly with the JSON output already landing in Phase 7.

## Solution

TBD — likely needs a `listAllTurns()`-style helper (cross-session enumeration already exists elsewhere, e.g. `blame`/`bisect`/`heatmap` use cross-session patterns) wired into `cost.js`'s `--all` branch instead of the single-session `listTurns()` call.

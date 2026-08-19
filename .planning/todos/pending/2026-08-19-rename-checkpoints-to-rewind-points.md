---
created: 2026-08-19T01:23:45.510Z
title: Rename "checkpoints" to "rewind points" in git turn log output
area: cli/ux
files:
  - src/commands/log.js
  - src/commands/show.js
  - README.md
---

## Problem

The current `git turn log` output uses "turn" and "checkpoint" language interchangeably. "Checkpoint" is an internal term; it doesn't tell a user what they can do with it.

## Idea to steal

**Grok Build** stores turn history as `rewind_points.jsonl`. "Rewind point" is better user-facing language — it implies directionality (go back), reversibility, and safety. It's what the user actually wants to do: rewind to a known-good state.

## Solution

- `git turn log` output: replace any "checkpoint" labels with "rewind point N"
- `git turn revert` description: "Rewind to rewind point N"
- `git turn show` header: "Rewind point N — <date>"
- README: update terminology throughout

Internal code (variable names, file paths, op log entries) can keep "turn" — it's accurate internally. The UX-facing surface uses "rewind point."

No functional change — terminology only.

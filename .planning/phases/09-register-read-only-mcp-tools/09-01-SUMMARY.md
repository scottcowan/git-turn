---
phase: 09-register-read-only-mcp-tools
plan: 01
subsystem: cli-commands
tags: [mcp-prerequisite, color-handling, tool-summary]
dependency-graph:
  requires: []
  provides:
    - "show.js compute() opts.color override"
    - "diff.js compute() opts.color override"
    - "show.js plain-text tool_summary rendering"
  affects:
    - "src/mcp/tools/show.js (future plan — will call compute(argv, { color: false }))"
    - "src/mcp/tools/diff.js (future plan — will call compute(argv, { color: false }))"
tech-stack:
  added: []
  patterns:
    - "opts.color !== undefined ? opts.color : shouldColor() — additive override that falls back to existing behavior when omitted"
key-files:
  created: []
  modified:
    - src/commands/show.js
    - src/commands/show.test.js
    - src/commands/diff.js
    - src/commands/diff.test.js
decisions:
  - "Guarded tool_summary rendering against null/array/empty-object values so malformed note data cannot throw (plan Test C requirement, T-09-03 disposition: accept)"
metrics:
  duration: "~45min"
  completed: 2026-11-01
---

# Phase 9 Plan 1: show.js/diff.js MCP-prerequisite changes Summary

Added an opts.color override to show.js and diff.js's compute() functions and a plain-text tool_summary render line to show.js, so the Phase 9/10 MCP adapters can force color off deterministically regardless of inherited FORCE_COLOR.

## What Was Built

**Task 1 (`e217a68`): show.js — tool_summary plain-text line (Gap 1) and opts.color override (Gap 2, D-02)**

- Added a `Tool summary: Read:2, Edit:1`-style line to show.js's plain-text output, placed after the `Model:`/`Latency:` lines and before the `Prompt:` block. Guarded to render only when `meta.tool_summary` is a non-null, non-array object with at least one key — so missing, empty-object, or malformed `tool_summary` values never produce the line and never throw.
- Added `const colorOn = opts.color !== undefined ? opts.color : shouldColor();` immediately after the `plain` flag is computed, and replaced both `shouldColor()` call sites (the `--plain` branch's `colorArg` ternary and the rich-render branch's `color:` option) with `colorOn`. `shouldColor()` itself (`src/git.js`) was not touched — confirmed via `git diff --stat src/git.js` showing no changes.
- 8 new tests (A-H) added to the existing `describe('show command')` block, covering: tool_summary rendering present/absent/empty-object, `opts.color` suppressing ANSI on both the rich and `--plain` branches under `FORCE_COLOR=1`, a regression guard proving default behavior (no `opts.color`) still colors under `FORCE_COLOR`, `opts.color: true` forcing color under `NO_COLOR`, and `--json` output unchanged.

**Task 2 (`9e888d5`): diff.js — opts.color override (Gap 2, D-02)**

- Applied the identical `colorOn` fix to diff.js's two `shouldColor()` call sites (the `--plain` branch and the rich-render branch). No `tool_summary` equivalent exists in diff.js (it has no Gap 1).
- 6 new tests (A-F) added to the existing `describe('diff command')` block, covering: `opts.color: false` suppressing ANSI on both branches and the single-turn form under `FORCE_COLOR=1`, a regression guard for default behavior, `opts.color: true` forcing color under `NO_COLOR`, and a byte-for-byte equivalence check between `opts.color: false` and the default output under `NO_COLOR`.

Both tasks followed RED/GREEN: new tests were written first and confirmed failing (A/D/E/G failed for show.js; A/B/C/E failed for diff.js — the remaining new tests in each set passed trivially pre-implementation since they assert *absence* of a not-yet-existing behavior), then the implementation was added and the full test files re-run to confirm GREEN.

## Verification

- `node --test src/commands/show.test.js` — 21/21 pass
- `node --test src/commands/diff.test.js src/commands/show.test.js` — 45/45 pass
- `npm test` (full suite including `mcp.test.js`) — exit 0, all suites pass
- `grep -c "shouldColor()" src/commands/show.js` → 1
- `grep -c "shouldColor()" src/commands/diff.js` → 1
- `grep -n "opts.color !== undefined ? opts.color : shouldColor()"` → exactly one match in each file
- `grep -n "Tool summary: "` → exactly one match in show.js
- `git diff --stat src/git.js` → no changes

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Both changes are complete, tested implementations with no placeholder values.

## Threat Flags

None — both changes stay within the threat_model's existing trust boundaries (process env -> compute(), git note content -> plain text) and existing dispositions (T-09-01, T-09-02, T-09-03). No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- FOUND: src/commands/show.js (modified)
- FOUND: src/commands/show.test.js (modified)
- FOUND: src/commands/diff.js (modified)
- FOUND: src/commands/diff.test.js (modified)
- FOUND: e217a68 (git log --oneline --all | grep e217a68)
- FOUND: 9e888d5 (git log --oneline --all | grep 9e888d5)

---
created: 2026-10-16T08:53:13.600Z
title: Claude Code Stop-hook for auto record-prompt capture
area: integration
files:
  - AGENTS.md
  - src/commands/record-prompt.js
---

## Problem

`git turn record-prompt` already exists and works (reads one JSON object on stdin — `prompt`/`model`/`usage`/`latency_ms`/`tool_summary` — and merges it into the latest turn's note), but nothing constructs and sends that payload automatically. AGENTS.md says explicitly: "No wrapper or hook ships yet that constructs this payload automatically — the caller is the operator or a future Claude Code Stop-hook." Today the only way to get prompt/model/usage captured is a manual `echo '{...}' | git turn record-prompt` pipe, so in practice capture doesn't happen for real Claude Code sessions.

This is the write-direction counterpart to v0.4's MCP server work (Phases 7-10), which is entirely read-direction (Claude Code calling git-turn's tools). This todo is about Claude Code automatically feeding git-turn, via its Stop hook mechanism, after every turn.

Also worth considering alongside this: packaging the hook (and possibly the Phase 8-10 MCP server registration) as a distributable Claude Code plugin, so a user can adopt both directions of the integration with one install rather than manual hook/MCP config wiring.

## Solution

TBD — likely a Claude Code Stop hook script that:
- Reads the Stop-hook payload Claude Code provides (prompt text, model, usage, latency, tool-call summary — exact shape needs checking against current Claude Code hook docs, since this project's cutoff knowledge of the hook payload shape may be stale)
- Maps it into the `{ prompt, model, usage, latency_ms, tool_summary }` shape `record-prompt` expects
- Pipes it to `git turn record-prompt`, scoped to the invoking repo

Separately: evaluate whether to ship this as a standalone hook script in this repo (e.g. `scripts/`) vs. a full Claude Code plugin manifest bundling the hook + (once Phase 8-10 ship) the MCP server registration.

Not required for v0.4's goal (read-only MCP tools) — revisit after Phase 10 ships, since VERIFY-04's real-client testing may surface relevant hook/session details that make this easier to scope correctly.

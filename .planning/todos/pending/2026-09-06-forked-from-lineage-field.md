---
created: 2026-09-06T11:49:20.072Z
title: Record forked_from lineage when a session branches from a turn
area: warren-integration
files:
  - src/session.js
---

## Problem

When warren branches a new workspace from turn-N (HIST-05), the new session currently starts with no record of where it came from — `newSession()` in `src/session.js` writes a plain `session.json` with no ancestry info. That leaves a flat list of unrelated sessions instead of a traceable ancestry graph: you can't answer "show me every session that ever branched off this one," which matters once warren workspaces fork repeatedly.

## Solution

Add a `forked_from: {session_id, turn_n}` field to `session.json`, populated when a session is created as a result of a branch operation (vs. a fresh `git turn init`). Likely touches:
- `src/session.js`'s `newSession()` — accept an optional `forkedFrom` param
- Whatever command/hook implements `git turn branch --from N` (currently listed as "not yet implemented" in `bin/git-turn`) — this is the natural place to pass `forkedFrom` through
- `git turn log`/`status` could optionally surface the lineage chain once this exists

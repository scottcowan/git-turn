---
created: 2026-09-06T11:49:20.072Z
title: Confirm op_id (replica_id, seq) dropped from note payload intentionally
area: warren-integration
files:
  - src/hooks/post-commit.js
---

## Problem

Warren's design doc and SEED-011 describe a stable `op_id: (replica_id, seq)` tuple as load-bearing for the branching/addressability model — warren needs to address a specific op across forked/merged history unambiguously. The shipped note payload in `src/hooks/post-commit.js` (`createCheckpoint()`) is actually `{session_id, turn_n, snapshot_sha, ts}` — there is no `op_id`, `replica_id`, or `seq` field anywhere in the codebase (confirmed via full-repo grep, zero matches).

Not clear whether this was:
- dropped intentionally (e.g. `session_id` + `turn_n` was judged sufficient and the design doc is stale), or
- a real gap — the design doc's addressability model was never implemented.

If the latter, this blocks warren's branching/addressability work (HIST-05 and related), not just a nice-to-have.

## Solution

Reread the warren design doc + SEED-011 against the current note schema and decide:
1. If `session_id`+`turn_n` already satisfies the addressability requirement — update the design doc to match reality, close this as resolved.
2. If `op_id: (replica_id, seq)` is actually required — add it to the note payload (likely `replica_id` = a stable per-clone/per-machine identifier, `seq` = a monotonic counter independent of `turn_n`, since `turn_n` resets per session) and migrate `cache.js`'s schema accordingly.

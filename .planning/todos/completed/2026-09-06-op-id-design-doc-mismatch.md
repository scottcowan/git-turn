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

## Resolution (2026-09-07): Option 1 — design doc was stale, not a real gap

Read `session-history-design.md` in full. The `op_id: (replica_id, seq)` scheme lives in the doc's original body (2026-08-07), motivated by a warren-server-owned SQLite index needing identity stable across "reordering, merge, and partial sync" in a multi-replica model. The **same document** has a "Design Revisions (2026-08-09)" section at the top — added two days later — that explicitly moved to "post-commit hook + jj-style op log, no server required... No warren server required for any write operation." That revision retroactively invalidates the op_id/CRDT motivation: the shipped architecture is single-repo, single-writer-per-session (post-commit hook serializes via a pending-promise chain), no multi-replica merge. `session_id` (UUID) + `turn_n` (monotonic, single-writer) already gives the same globally-unique, immutable, addressable-pair property `(replica_id, seq)` was for.

Fixed on the warren side (commit `01135a0` in `/Users/scowan/Projects/scottcowan/warren`):
- Annotated the now-superseded sections of `session-history-design.md` (Storage Design §§2-4, API Surface) rather than deleting them — they're still useful context if warren's branch model ever grows a real two-way merge case.
- Found and fixed a second, unrelated staleness in `SEED-011-generic-turn-ref-protocol.md`: it named a ref namespace (`refs/turns/...`) that was never built — git-turn shipped `refs/git-turn/...` instead. Corrected the format-blob example to the actual shipped schema (verified against a live git-turn repo's `refs/git-turn/format` blob and `src/commands/init.js`).
- Surfaced a real, separate gap while there: git-turn's shipped format blob has no `snapshot_model` field, so HIST-05's `POST /workspaces/{id}/branch` can't yet determine how to extract the worktree tree from a ref using only what's declared. Noted in SEED-011 for whoever picks up warren's branch endpoint — not fixed here, out of scope for this todo.

No git-turn code changes needed — the note payload `{session_id, turn_n, snapshot_sha, ts}` is correct as shipped.

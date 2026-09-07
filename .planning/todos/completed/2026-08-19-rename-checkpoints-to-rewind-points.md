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

## Resolution (2026-09-07): Dropped

Two things surfaced during review that killed this:

1. **Premise was already stale.** Grepped `log.js`, `show.js`, `README.md` — no "checkpoint" language exists anywhere in shipped output. Whatever prompted this on 2026-08-19 no longer describes the code. Current output already consistently uses "turn N".
2. **The borrowed term doesn't mean what we assumed.** Checked Grok Build's actual source (`xai-org/grok-build`) and docs. Their `/rewind` command is documented explicitly: "does not restore files on disk. Only conversation history is truncated." Despite storing per-prompt file-state snapshots internally (`rewind_points.jsonl`, indexed by `prompt_index`), their user-facing `/rewind` is conversation-only undo — not a file safety net. The name implies file-level reversibility; their shipped command doesn't deliver that. Adopting "rewind point" wholesale would import a naming metaphor whose most prominent user (Grok Build itself) attaches weaker semantics to it than what git-turn's `revert`/`redo` actually does.
3. **Separately**, the command itself is `git turn` — renaming the user-facing noun to "rewind point" while the invocation stays `git turn <cmd>` creates a naming mismatch (`git turn log` printing "rewind point 3").

Not pursuing. `git turn`/"turn" stays the user-facing term throughout.

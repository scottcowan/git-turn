---
created: 2026-10-07T19:13:27.361Z
title: Explore stable change-identity beyond SHA anchoring
area: research
files:
  - src/git.js (updateNote, parseSnapshotMessage)
  - refs/notes/git-turn (keyed by HEAD sha)
---

## Problem

Delta (delta.dev, from the Zed team) ships DeltaDB — a from-scratch VCS that tracks fine-grained
deltas with *stable identities* that survive code evolving/refactoring, so a comment/annotation
stays anchored to "this logical change" even as the surrounding code shifts.

git-turn's turn/note model has no equivalent: `refs/notes/git-turn` is keyed purely by the HEAD
commit sha, and snapshot refs are per-turn commits. If history is rewritten (rebase, squash,
filter-repo) or a line moves far enough that `blame --porcelain` can't track it, the note/turn
attribution has no fallback — it's SHA or nothing. Worth investigating whether a lighter-weight
stable-identity scheme (e.g. content-hash-based anchors, or diff-hunk fingerprinting) could make
`blame`, `show`, and `redact` more robust to history rewrites, without adopting any of Delta's
heavier machinery.

Explicitly NOT in scope: multiplayer collaboration, cloud sync, or replacing git's commit model —
all conflict with git-turn's "no server required, works in any git repo" design decision
(see PROJECT.md Key Decisions).

## Solution

TBD — possible directions to research:
- Content-hash anchors (hash of the changed hunk's content) as a secondary lookup key alongside sha
- Survey how `git blame -C`/`-M` (copy/move detection) could inform a "best-effort" attribution fallback when exact sha lookup misses
- Decide if this is worth a research phase at all, or stays a backlog curiosity — no user complaint has surfaced yet, this is purely inspired by a competitor's launch

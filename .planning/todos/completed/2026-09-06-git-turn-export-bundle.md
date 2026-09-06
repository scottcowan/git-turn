---
created: 2026-09-06T11:49:20.072Z
title: Add git turn export for portable turn-history handoff between warrens
area: warren-integration
files:
  - bin/git-turn
---

## Problem

Warren's SEED for shared storage/send between warrens has an Option C: git-as-transport — one warren instance hands off session history to another. There's currently no way to export just the git-turn namespace (turn refs + notes) without granting full repo access, which is the cheapest version of that option to unblock.

## Solution

`git turn export --since <ref>` producing a `git bundle` scoped to just `refs/git-turn/sessions/**`, `refs/notes/git-turn`, and `refs/git-turn/format` (not the full repo). The receiving warren would `git bundle unbundle` (or fetch from it) into its own repo to pull in the exported turns/notes. Keep it read-only/export-only for now — no merge/import logic — that's a separate concern once this seed's transport mechanism is validated.

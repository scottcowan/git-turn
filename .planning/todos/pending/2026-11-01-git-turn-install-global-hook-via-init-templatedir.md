---
created: 2026-11-01T17:00:29.894Z
title: git turn install-global-hook via init.templateDir
area: cli
files:
  - src/commands/init.js
---

## Problem

Users have to remember to run `git turn init` for every repo they work in — easy to forget, especially right after `git clone`. Git has a built-in mechanism for exactly this: `init.templateDir` — anything placed there gets copied into `.git/` on every `git init` *and* `git clone` (clone performs an implicit init). A `post-checkout` hook placed there could auto-run `git turn init` on every future repo with zero per-repo action needed.

This should be strictly opt-in — a new, separate command, not a change to default behavior. Running plain `git turn init` per-repo must keep working exactly as it does today.

## Solution

Add a new command, e.g. `git turn install-global-hook` (name TBD), that:
1. Checks `git config --global init.templateDir`. If unset, create a git-turn-managed template dir (e.g. `~/.git-turn-templates`) and set it. If already set by the user for something else, do NOT overwrite it — write/append into their existing template dir instead, mirroring the pattern `git turn init` already uses for a foreign `core.hooksPath` hook file (appends rather than overwrites, per AGENTS.md's existing hooksPath handling).
2. Writes (or appends to) a `post-checkout` hook inside that template dir that shells out to `git turn init`. `git turn init` is already idempotent/safe to re-run, so no extra guard logic needed there.
3. Needs to handle: the hook firing on non-git-turn-relevant checkouts too (should this inspect anything before running `git turn init` unconditionally? probably fine since init is already a safe no-op-ish operation, but worth checking its actual behavior on a repo the user doesn't want tracked).

Caveats to design around (worth re-reading before implementing):
- Hooks are never copied by `git clone` directly — but `git clone` performs an implicit `git init` on the new local repo, which IS where the template dir gets applied. So this does work for clones, just via the init step, not the clone step itself.
- `post-checkout` fires on the initial checkout after clone (with args indicating a branch-switch-like event) — need to verify the exact argument shape to avoid misfiring logic if any conditional behavior is added later.
- This is a one-time global setup step the user runs once (not per-repo, not installable from inside a single project's own `git turn init`) — command naming/docs should make that clear.

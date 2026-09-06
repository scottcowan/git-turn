---
created: 2026-09-06T11:49:20.072Z
title: Add secret redaction for turn notes before they're written
area: security
files:
  - src/hooks/post-commit.js
  - src/git.js
---

## Problem

Turn notes (`refs/notes/git-turn`) can store prompt/response content per turn permanently. If a prompt accidentally contains a pasted API key or credential, it's baked into git history forever — `git notes` entries aren't cleaned up by normal history-rewrite workflows (no `git filter-repo` equivalent runs on them by default), so a leaked secret in a note is much stickier than one in a commit message.

## Solution

Two complementary options, either or both:
1. `git turn redact <N>` — a command to scrub/replace a specific turn's note content after the fact (rewrite the note, not the snapshot).
2. A pre-note secret-pattern scan in `post-commit.js`'s `createCheckpoint()`, run against the note payload before `addNote()` — reuse whatever pattern list warren's secret store maintains (AWS keys, generic high-entropy tokens, etc.) rather than inventing a new one. On a match, redact the matched substring in the note payload before writing (don't block the commit — the code itself is already committed either way).

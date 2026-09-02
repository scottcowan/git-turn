---
phase: 3
slug: bisect-blame
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-02
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no dependency) |
| **Config file** | none — invoked via `npm test` → `node --test` (see `package.json` scripts) |
| **Quick run command** | `node --test src/commands/blame.test.js` / `node --test src/commands/bisect.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run the relevant single test file (`node --test src/commands/blame.test.js` or `bisect.test.js`)
- **After every plan wave:** Run `npm test` (full suite — 23+ existing tests must stay green alongside new ones)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 03-01 | 1 | D-01 | — | Per-line blame reports correct turn for a simple single-session multi-turn edit history | unit | `node --test src/commands/blame.test.js` | ❌ W0 | ⬜ pending |
| 03-01-02 | 03-01 | 1 | D-02 | — | Blame enumerates turns across ALL sessions, not just current | unit | `node --test src/commands/blame.test.js` | ❌ W0 | ⬜ pending |
| 03-01-03 | 03-01 | 1 | — | — | Untracked-only file falls back to hunk-diff annotation correctly | unit | `node --test src/commands/blame.test.js` | ❌ W0 | ⬜ pending |
| 03-02-01 | 03-02 | 2 | D-03 | — | Bisect refuses to start with a dirty worktree | unit | `node --test src/commands/bisect.test.js` | ❌ W0 | ⬜ pending |
| 03-02-02 | 03-02 | 2 | D-04 | — | Bisect always restores original worktree state (success, no-bad-turn-found, thrown error paths) | unit | `node --test src/commands/bisect.test.js` | ❌ W0 | ⬜ pending |
| 03-02-03 | 03-02 | 2 | D-05 | — | Bisect prints live per-candidate progress and a final "turn N introduced the failure" line | unit (stdout capture) | `node --test src/commands/bisect.test.js` | ❌ W0 | ⬜ pending |
| 03-02-04 | 03-02 | 2 | — | — | 125 (skip) and ≥128 (abort) exit codes are handled per the documented convention | unit | `node --test src/commands/bisect.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/commands/blame.test.js` — covers per-line attribution, cross-session enumeration, untracked-fallback, and the "line belongs to a pre-git-turn / non-turn commit" case
- [ ] `src/commands/bisect.test.js` — covers dirty-worktree refusal, guaranteed restore across success/failure/throw paths, live progress output, and exit-code classification (0/125/128+/other)
- [ ] Multi-session test fixtures — existing `src/helpers/test-repo.js` supports multi-commit repos, but no existing test calls `newSession()`/`incrementTurn()` more than once within one test repo. This phase is the first to need genuinely cross-session fixtures; Wave 0 for `blame.test.js` must establish that fixture pattern before the cross-session assertion (D-02) can be written.

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification via `node --test`.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 3
slug: bisect-blame
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-02
updated: 2026-09-02
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Task IDs reconciled against the 4 plans created on 2026-09-02.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no dependency) |
| **Config file** | none — invoked via `npm test` → `node --test` (see `package.json` scripts) |
| **Quick run commands** | `node --test src/blame-util.test.js` · `node --test src/commands/blame.test.js` · `node --test src/commands/bisect.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run the single test file named in that task's `<verify><automated>`
- **After every plan wave:** Run `npm test` (full suite — 23+ existing tests must stay green alongside new ones)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 03-01 | 1 | — | T-03-SC | Multi-session turn fixtures exist; existing revert suite still green on the shared helper | unit | `node --test src/commands/revert.test.js` | ✅ exists | ⬜ pending |
| 03-01-02 | 03-01 | 1 | D-02 | T-03-01, T-03-02 | Cross-session enumeration (cache-first + ref fallback), head_sha index with collision reporting, ancestry filter, topology order | unit | `node --test src/blame-util.test.js` | ❌ W0 (created by this task) | ⬜ pending |
| 03-01-03 | 03-01 | 1 | — | T-03-04 | Hunk-header parser handles omitted `,count`; porcelain parser; untracked-snapshot annotator | unit | `node --test src/blame-util.test.js` | ❌ W0 (extended by this task) | ⬜ pending |
| 03-02-01 | 03-02 | 2 | D-01 | T-03-11, T-03-12 | Per-line blame for tracked files; not-a-turn and uncommitted labels; usage/not-initialized paths | unit (stdout capture) | `node --test src/commands/blame.test.js` | ❌ W0 (created by this task) | ⬜ pending |
| 03-02-02 | 03-02 | 2 | D-02 | T-03-14 | Attribution spans all sessions; untracked-only fallback; `--no-cache` output parity | unit (stdout capture) | `node --test src/commands/blame.test.js` | ❌ W0 (extended by this task) | ⬜ pending |
| 03-03-01 | 03-03 | 2 | D-03, D-04 | T-03-22, T-03-23, T-03-24 | Dirty-worktree refusal before any mutation; HEAD-reachable candidates only; restore on success / clean / thrown paths | unit | `node --test src/commands/bisect.test.js` | ❌ W0 (created by this task) | ⬜ pending |
| 03-03-02 | 03-03 | 2 | D-05 | — | Binary search locates first failing turn in ≤ log2(n) runs; header, per-candidate progress, verdict, final restore line | unit (stdout capture) | `node --test src/commands/bisect.test.js` | ❌ W0 (extended by this task) | ⬜ pending |
| 03-03-03 | 03-03 | 2 | D-04 | T-03-21, T-03-23, T-03-26 | Exit codes 0/125/≥128/null classified per `git bisect run`; bisect-end op logged; SIGINT/SIGTERM listeners registered and removed | unit | `node --test src/commands/bisect.test.js` | ❌ W0 (extended by this task) | ⬜ pending |
| 03-04-01 | 03-04 | 3 | D-01…D-05 | T-03-31, T-03-32, T-03-33 | Docs describe both commands, flags and the `<cmd>` shell-privilege boundary; dispatcher confirmed to resolve both modules | integration (CLI + grep) | `npm test && node bin/git-turn blame 2>&1 \| grep -c 'not yet implemented'` | ✅ exists | ⬜ pending |
| 03-04-02 | 03-04 | 3 | D-04, D-05 | T-03-23 | Real-repo legibility of blame/bisect output; worktree unchanged after a real bisect | manual (checkpoint:human-verify) | none — blocking developer checkpoint | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 work is folded into plan 03-01, which runs alone in wave 1 ahead of every consumer:

- [x] **Multi-session test fixtures** — `src/helpers/turn-fixtures.js` (`startSession`, `makeTurn`, `makeUntrackedTurn`) is created by task 03-01-01, before task 03-01-02 writes the D-02 cross-session assertion. This closes the gap flagged in 03-RESEARCH.md: no existing test calls `newSession()`/`incrementTurn()` more than once in one repo. Task 03-01-01 also refactors `src/commands/revert.test.js` onto the shared helper, so the fixture is proven signature-compatible with the existing suite before anything new depends on it.
- [x] `src/blame-util.test.js` — created by 03-01-02, extended by 03-01-03
- [x] `src/commands/blame.test.js` — created by 03-02-01, extended by 03-02-02
- [x] `src/commands/bisect.test.js` — created by 03-03-01, extended by 03-03-02 and 03-03-03
- [x] No framework install needed — `node:test` is already wired via `npm test`

`wave_0_complete` stays `false` until plan 03-01 has actually executed.

---

## Sampling Continuity

Every task in every plan carries an `<automated>` verify command. The longest run of tasks without a fresh automated signal is 1, well inside the no-3-consecutive rule. The only exception is 03-04-02, a `checkpoint:human-verify` by design, and it is preceded immediately by 03-04-01's full-suite run.

Ordering constraint honoured: the D-02 cross-session assertion (03-01-02, and again at 03-02-02) is written only after the multi-session fixture exists (03-01-01).

---

## Manual-Only Verifications

| Verification | Task | Why not automated |
|--------------|------|-------------------|
| Blame attribution column legibility at 80 columns; bisect commentary followability while running | 03-04-02 | Output aesthetics and "can a human follow this live" are judgement calls; the underlying strings are asserted by 03-02-01/02 and 03-03-02 |
| Worktree unchanged after a real bisect in a real repo | 03-04-02 | D-04 is asserted against fixtures in 03-03-01; this is a belt-and-braces check against a repo with genuine turn history |
| Ctrl-C / SIGKILL restore behaviour | none | 03-RESEARCH.md Pitfall 3 documents this as a residual risk. 03-03-03 asserts the listener-count invariant; a hard kill or detached child is explicitly out of scope and must be recorded as a known gap in the summary rather than claimed as covered |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a documented manual justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references, and the fixture gap precedes the D-02 assertion
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved at planning (2026-09-02)

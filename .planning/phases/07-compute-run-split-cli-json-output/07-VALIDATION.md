---
phase: 7
slug: compute-run-split-cli-json-output
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-10-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`), no third-party framework |
| **Config file** | none — `package.json`'s `"scripts": { "test": "node --test" }` is the only config |
| **Quick run command** | `node --test src/commands/diff.test.js` (swap in `show.test.js`/`log.test.js`/`blame.test.js`/`cost.test.js`/`diff-render.test.js` as relevant) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5-10 seconds (full suite was 217 tests as of v0.3 close) |

---

## Sampling Rate

- **After every task commit:** Run the specific command's test file (e.g. `node --test src/commands/diff.test.js`), plus `diff-render.test.js` whenever that module changes.
- **After every plan wave:** `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green, plus a manual terminal eyeball of the rich-render output (ANSI rendering can't be meaningfully asserted byte-for-byte in a way that also proves visual correctness).
- **Max feedback latency:** ~10 seconds (full suite runtime).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | REFACTOR-01 | — | N/A | unit | `node --test src/commands/log.test.js src/commands/show.test.js src/commands/diff.test.js src/commands/blame.test.js src/commands/cost.test.js` | ✅ existing files, must pass unmodified | ⬜ pending |
| 07-01-02 | TBD | 0 | REFACTOR-01, JSON-01 | — | N/A | unit | new `compute()`-direct test cases per command file | ❌ W0 | ⬜ pending |
| 07-02-01 | TBD | 0 | DIFF-01 | — | N/A | unit | `node --test src/diff-render.test.js` | ❌ W0 — new file | ⬜ pending |
| 07-02-02 | TBD | 0 | DIFF-01 | — | N/A | regression | `--plain` byte-identity cases in `diff.test.js`/`show.test.js` | ❌ W0 | ⬜ pending |
| 07-03-01 | TBD | 0 | JSON-01 | — | N/A | unit | `--json` schema assertions per command, plus `{"error":...}` + exit 1 path | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact task IDs finalized once the planner writes PLAN.md files.*

---

## Wave 0 Requirements

- [x] `src/diff-render.test.js` — assigned to plan 07-01 (TDD RED/GREEN), covers `parseDiff()`'s `{added, removed}` counting and `renderRich()`'s structural output (gutter numbers, line-type classification, summary header), both with `color: true` and `color: false`
- [x] New test cases in each of `log.test.js`/`show.test.js`/`diff.test.js`/`blame.test.js`/`cost.test.js` directly importing and calling `compute(args)` — assigned to plans 07-02 (log/blame), 07-03 (cost), 07-04 (diff/show)
- [x] New `--json` test cases per command file — assigned to plans 07-02, 07-03, 07-04
- [x] New `--plain` byte-identity test cases in `diff.test.js`/`show.test.js` — assigned to plan 07-04, verified via `git diff 98679b8 -- <test file>` additions-only check
- [x] Framework install: none — `node --test` already wired via `npm test`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rich diff renderer visual correctness (gutter alignment, background color legibility, summary header placement) | DIFF-01 | ANSI terminal rendering can't be meaningfully asserted byte-for-byte in a way that also proves visual correctness — structural assertions (gutter numbers present, line classified correctly) are automated, but "does it look right" needs an eyeball check | Run `git turn diff <N>` and `git turn show <N>` against a real repo with real changes; visually confirm full-row background highlight, correct gutter numbers, summary header at top, and correct NO_COLOR/FORCE_COLOR degradation |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by plan checker (Nyquist Compliance: PASS)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — confirmed by plan checker
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-08 (plan checker VERIFICATION PASSED, 0 blockers)

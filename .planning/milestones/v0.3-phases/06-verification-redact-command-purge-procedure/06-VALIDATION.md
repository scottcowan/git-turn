---
phase: 6
slug: verification-redact-command-purge-procedure
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-21
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no dependency) |
| **Config file** | none — bare `node --test` via `npm test` |
| **Quick run command** | `node --test src/commands/show.test.js src/commands/cost.test.js src/commands/redact.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1-2 seconds |

---

## Sampling Rate

- **After every task commit:** the specific new/modified test file for that task
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | VERIFY-01 | — | `show <N>`/`show <N> --with-prompts` resolve notes via real HEAD sha (not snapshot sha), render real prompt/model/latency after a real `record-prompt` call | integration | `node --test src/commands/show.test.js` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | VERIFY-01 | — | `log --with-prompts` (both cache and `--no-cache` paths) render real prompt data | integration | `node --test src/commands/log.test.js` | ✅ | ✅ green |
| 06-02-01 | 02 | 1 | VERIFY-02 | — | `cost` computes a correct nonzero dollar cost from real `usage`, using a network-free pricing fixture (HOME-scoped cache seed) | integration | `node --test src/commands/cost.test.js` | ✅ | ✅ green |
| 06-03-01 | 03 | 1 | REDACT-02 | T-06-03 | `redact <N>` clears `prompt` (resolved via correct sha), leaves model/usage/latency_ms/tool_summary intact, no-ops when there's no prompt | unit/integration | `node --test src/commands/redact.test.js` | ✅ | ✅ green |
| 06-04-01 | 04 | 2 | REDACT-03 | T-06-01, T-06-02 | `gc --purge-notes` collapses notes history then reflog-expire + prune actually removes the old blob — object-store-level assertion (`git cat-file -e` fails on old blob sha) | integration | `node --test src/git.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/commands/show.test.js` — new, first-ever test coverage for `show.js`; must exercise the sha-resolution fix
- [x] `src/commands/log.test.js` — new, first-ever test coverage for `log.js`; covers both cache and `--no-cache` paths
- [x] `src/commands/cost.test.js` — new, first-ever test coverage for `cost.js`; needs HOME-scoped pricing-cache-seed helper
- [x] `src/commands/redact.test.js` — new, for the new `redact.js` command
- [x] `src/git.test.js` — extended with `purgeNotesHistory()` tests including the object-store-level assertion and the missing-reflog edge case
- [x] Framework install: none needed — `node:test` is built in

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification, including the object-store-level purge assertion via `git cat-file -e`.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`show.test.js`, `log.test.js`, `cost.test.js`, `redact.test.js`, `git.test.js` extension)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete — 06-01/06-02/06-03/06-04 executed, full suite green (217/217 at phase close, including 5 code-review fixes).

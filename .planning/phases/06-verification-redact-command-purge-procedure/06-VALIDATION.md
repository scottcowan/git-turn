---
phase: 6
slug: verification-redact-command-purge-procedure
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 06-01-01 | 01 | 1 | VERIFY-01 | — | `show <N>`/`show <N> --with-prompts` resolve notes via real HEAD sha (not snapshot sha), render real prompt/model/latency after a real `record-prompt` call | integration | `node --test src/commands/show.test.js` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | VERIFY-01 | — | `log --with-prompts` (both cache and `--no-cache` paths) render real prompt data | integration | `node --test src/commands/log.test.js` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | VERIFY-02 | — | `cost` computes a correct nonzero dollar cost from real `usage`, using a network-free pricing fixture (HOME-scoped cache seed) | integration | `node --test src/commands/cost.test.js` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 1 | REDACT-02 | T-06-03 | `redact <N>` clears `prompt` (resolved via correct sha), leaves model/usage/latency_ms/tool_summary intact, no-ops when there's no prompt | unit/integration | `node --test src/commands/redact.test.js` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 2 | REDACT-03 | T-06-01, T-06-02 | `gc --purge-notes` collapses notes history then reflog-expire + prune actually removes the old blob — object-store-level assertion (`git cat-file -e` fails on old blob sha) | integration | `node --test src/git.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/commands/show.test.js` — new, first-ever test coverage for `show.js`; must exercise the sha-resolution fix
- [ ] `src/commands/log.test.js` — new, first-ever test coverage for `log.js`; covers both cache and `--no-cache` paths
- [ ] `src/commands/cost.test.js` — new, first-ever test coverage for `cost.js`; needs HOME-scoped pricing-cache-seed helper
- [ ] `src/commands/redact.test.js` — new, for the new `redact.js` command
- [ ] `src/git.test.js` — extended with `purgeNotesHistory()` tests including the object-store-level assertion and the missing-reflog edge case
- [ ] Framework install: none needed — `node:test` is built in

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification, including the object-store-level purge assertion via `git cat-file -e`.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`show.test.js`, `log.test.js`, `cost.test.js`, `redact.test.js`, `git.test.js` extension)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 5
slug: record-prompt-note-write-path
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-18
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no dependency) |
| **Config file** | none — bare `node --test` via `npm test` script |
| **Quick run command** | `node --test src/record-prompt.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1-2 seconds |

---

## Sampling Rate

- **After every task commit:** `node --test src/record-prompt.test.js` (and any new `src/git.test.js`/`src/cache.test.js` if the planner adds them)
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | CAPTURE-01 | — | Merge preserves hook fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`); retry-on-conflict resolves a simulated race | unit | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | CAPTURE-02 | T-05-02 | `usage` written verbatim in Anthropic shape; `cost.js` computes nonzero cost end-to-end | integration | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | CAPTURE-03 | — | `latency_ms` passed through and persisted in both note and cache | unit | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | CAPTURE-04 | — | `tool_summary` per-tool breakdown persisted and round-trips through JSON | unit | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | — | T-05-01 | Mandatory `redact()` call on `prompt` before any write; no opt-out | unit | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |
| 05-01-06 | 01 | 1 | — | T-05-03 | Malformed JSON stdin / non-object `usage` / non-string `prompt` fails loudly (stderr + exit 1), never silently coerces | unit | `node --test src/record-prompt.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/commands/record-prompt.js` — does not exist yet; this phase creates it
- [ ] `src/record-prompt.test.js` — new file, covers CAPTURE-01 through CAPTURE-04 plus JSON-parse-failure and non-string-prompt error paths
- [ ] `updateNote()` in `src/git.js` — new merge-and-retry helper; planner decides whether to unit-test via a new `src/git.test.js` or colocate coverage in `record-prompt.test.js`
- [ ] `usage TEXT`/`tool_summary TEXT` columns + `updatePromptFields()` in `src/cache.js` — migration; planner decides whether to unit-test via a new `src/cache.test.js` or colocate coverage
- [ ] Framework install: none needed — `node:test` is built in

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification via `src/record-prompt.test.js` (and any colocated `updateNote`/cache-migration tests).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`src/commands/record-prompt.js`, `src/record-prompt.test.js`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

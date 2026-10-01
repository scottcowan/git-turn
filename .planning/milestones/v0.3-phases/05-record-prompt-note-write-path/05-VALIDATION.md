---
phase: 5
slug: record-prompt-note-write-path
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| **Quick run command** | `node --test src/commands/record-prompt.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1-2 seconds |

---

## Sampling Rate

- **After every task commit:** `node --test src/git.test.js` / `node --test src/cache.test.js` / `node --test src/commands/record-prompt.test.js` (per plan)
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | CAPTURE-01 | T-05-03 | RED: `updateNote()` does not exist yet | unit | `node --test src/git.test.js` | ✅ | ✅ green |
| 05-01-02 | 01 | 1 | CAPTURE-01 | T-05-03 | GREEN: `updateNote(ref, sha, patchFn)` bounded read-compare-retry merge helper preserves hook fields | unit | `node --test src/git.test.js` | ✅ | ✅ green |
| 05-02-01 | 02 | 1 | CAPTURE-02, CAPTURE-03, CAPTURE-04 | T-05-04 | RED: `usage`/`tool_summary` columns and `updatePromptFields()` do not exist yet | unit | `node --test src/cache.test.js` | ✅ | ✅ green |
| 05-02-02 | 02 | 1 | CAPTURE-02, CAPTURE-03, CAPTURE-04 | T-05-04 | GREEN: guarded `ALTER TABLE` migration + `updatePromptFields()` COALESCE merge persists `usage`/`latency_ms`/`tool_summary` | unit | `node --test src/cache.test.js` | ✅ | ✅ green |
| 05-03-01 | 03 | 2 | CAPTURE-01..04 | T-05-01, T-05-02 | `record-prompt` reads stdin JSON, redacts `prompt`, resolves target turn via `listTurns()`/`parseSnapshotMessage()` (never bare `HEAD`), merges via `updateNote()`, updates cache | unit + integration | `node --test src/commands/record-prompt.test.js` | ✅ | ✅ green |
| 05-03-02 | 03 | 2 | CAPTURE-02 | T-05-02 | `usage` written verbatim in Anthropic shape; note/cache round-trip asserted (deepEqual) | integration | `node --test src/commands/record-prompt.test.js` | ✅ | ✅ green |
| 05-03-03 | 03 | 2 | — | — | `bin/git-turn` registration + `--help`/`AGENTS.md` documentation | design review | grep gate + manual `--help` check | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/commands/record-prompt.js` — does not exist yet; Plan 05-03 creates it
- [x] `src/commands/record-prompt.test.js` — does not exist yet; Plan 05-03 creates it (colocated with other command tests per project convention, not the standalone `src/record-prompt.test.js` path this document originally sketched)
- [x] `updateNote()` in `src/git.js` — does not exist yet; Plan 05-01 creates it plus a new `src/git.test.js`
- [x] `usage TEXT`/`tool_summary TEXT` columns + `updatePromptFields()` in `src/cache.js` — does not exist yet; Plan 05-02 creates them plus a new `src/cache.test.js`
- [x] Framework install: none needed — `node:test` is built in

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification via `src/git.test.js`, `src/cache.test.js`, and `src/commands/record-prompt.test.js`.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`src/commands/record-prompt.js`, `src/commands/record-prompt.test.js`, `src/git.js`/`src/git.test.js`, `src/cache.js`/`src/cache.test.js`)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete — 05-01/05-02/05-03 executed, full suite green (193/193 at phase close).

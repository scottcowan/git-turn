---
phase: 4
slug: secret-redaction-scanner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-17
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in, no dependency) |
| **Config file** | none — `package.json` `scripts.test` is `node --test`, auto-discovers `*.test.js` |
| **Quick run command** | `node --test src/redact.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1 second (unit tests only, no subprocess/git spawns) |

---

## Sampling Rate

- **After every task commit:** Run `node --test src/redact.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | REDACT-01 | — | Detects and redacts all 9 vendor-prefixed secret categories | unit | `node --test src/redact.test.js` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | REDACT-01 | — | Catches high-entropy tokens with no vendor prefix (Shannon entropy fallback) | unit | `node --test src/redact.test.js` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | REDACT-01 | T-04-01 | Whitelists 40-hex git SHAs and UUID-v4 shapes from entropy fallback (D-03) — prevents false-positive redaction of legitimate commit/session references | unit | `node --test src/redact.test.js` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | REDACT-01 | — | Runs unconditionally — no bypass mechanism exists (`redact(text)` takes no options argument) | design review | code review — no runtime flag/parameter to disable | N/A | ⬜ pending |
| 04-01-05 | 01 | 1 | REDACT-01 | — | Documents false-negative behavior against realistic fixtures (paraphrased secrets, low-entropy passwords) — SC3 | unit (asserting the known gap) | `node --test src/redact.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/redact.js` — does not exist yet; this phase creates it (`redact(text) -> { text, count }`)
- [ ] `src/redact.test.js` — does not exist yet; this phase creates it (vendor patterns, entropy fallback, SHA/UUID whitelist, documented false-negative fixtures)
- [ ] Framework install: none needed — `node:test` is built in, already used by `src/blame-util.test.js`

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification via `src/redact.test.js`, except the "no bypass flag" property which is verified by design/code review (no options parameter exists on `redact(text)`) rather than a runtime test, since there is nothing to invoke.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`src/redact.js`, `src/redact.test.js`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

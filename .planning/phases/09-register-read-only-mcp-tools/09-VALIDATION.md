---
phase: 9
slug: register-read-only-mcp-tools
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-11-01
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in), `node:assert/strict` |
| **Config file** | none — `package.json`'s `"test"` script: `node --test $(find src -name '*.test.js' ! -name 'mcp.test.js') && node --test src/commands/mcp.test.js` |
| **Quick run command** | `node --test src/mcp/tools/<name>.test.js` (per-tool, no subprocess spawn needed) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5-10s added (5 new unit-test files + a handful of new cases in existing diff.test.js/show.test.js) |

---

## Sampling Rate

- **After every task commit:** Run the targeted `node --test <file>` for the file(s) touched.
- **After every plan wave:** Run `npm test` (full suite, including the isolated `mcp.test.js` subprocess pass from Phase 8 — unaffected by this phase but must stay green).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-XX-XX | TBD | — | MCP-04 | — | `git_turn_log` success + error path | unit (direct handler call) | `node --test src/mcp/tools/log.test.js` | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-05 | — | `git_turn_show` success + error + `tool_summary`-in-text (Gap 1) | unit | `node --test src/mcp/tools/show.test.js` | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-06 | — | `git_turn_diff` success + error + two-turn form | unit | `node --test src/mcp/tools/diff.test.js` | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-07 | — | `git_turn_blame` success + error | unit | `node --test src/mcp/tools/blame.test.js` | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-08 | — | `git_turn_cost` success (async) + error | unit | `node --test src/mcp/tools/cost.test.js` | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-09 | — | All 5 tools: thrown `Error` → `isError: true` with exact message | unit | same 5 files above, error-path cases | ❌ W0 | ⬜ pending |
| 09-XX-XX | TBD | — | MCP-10 | — | `diff`/`show` `compute(args, { color: false })` never emits ANSI (Gap 2) | unit | `node --test src/commands/diff.test.js src/commands/show.test.js` | existing files, new cases | ⬜ pending |
| 09-XX-XX | TBD | — | VERIFY-03 | — | Live round-trip (real `addNote`+`makeTurn` fixtures, not hand-built) through `show`/`log`/`cost` handlers | integration (direct handler call against a real test-repo fixture) | same per-tool `.test.js` files, `VERIFY-03`-tagged test names | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are placeholders — the planner assigns final `{plan}-{task}` IDs.*

---

## Wave 0 Requirements

- [ ] `src/mcp/tools/log.test.js`, `show.test.js`, `diff.test.js`, `blame.test.js`, `cost.test.js` — new files, one per tool, covering success/error/VERIFY-03-round-trip per the map above.
- [ ] New test cases added to existing `src/commands/show.test.js` (Gap 1: `tool_summary` in plain-text output) and `src/commands/diff.test.js`/`show.test.js` (Gap 2: `opts.color` override) — additions to existing suites, no new files.
- [ ] No new test framework or fixture helpers needed — `makeTestRepo`/`startSession`/`makeTurn`/`addNote` already exist in `src/helpers/test-repo.js` and `src/helpers/turn-fixtures.js`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full stdio round-trip with all 5 tools via a real MCP client | Phase 9 success criterion 1/2 (indirectly) | Phase 9's own tests call tool handlers directly, not through a live stdio transport — full-client E2E is explicitly Phase 10's VERIFY-04 scope | Covered by Phase 10, not re-tested here |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

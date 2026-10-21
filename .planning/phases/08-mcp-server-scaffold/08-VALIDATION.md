---
phase: 8
slug: mcp-server-scaffold
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-21
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in), `node:assert/strict` — per `package.json`'s `"test": "node --test"` and every existing `*.test.js` file |
| **Config file** | none — `node --test` auto-discovers `**/*.test.js` |
| **Quick run command** | `node --test src/commands/mcp.test.js` / `node --test src/commands/cost.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5-10s added (one subprocess-spawn integration test file + extended cost.js cases) |

---

## Sampling Rate

- **After every task commit:** Run the targeted `node --test <file>` for the file(s) touched.
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green, plus a one-time manual smoke test with a real MCP client if available (not automatable in this sandbox).
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-XX | 01 | 1 | MCP-01 | — | `git turn mcp` completes `initialize`/`notifications/initialized` handshake with a real-shaped JSON-RPC client | integration (subprocess) | `node --test src/commands/mcp.test.js` | ❌ W0 | ⬜ pending |
| 08-01-XX | 01 | 1 | MCP-02 | — | Uninitialized repo: loud stderr (exact CLI string), exit nonzero, no lingering process | integration (subprocess) | `node --test src/commands/mcp.test.js` | ❌ W0 | ⬜ pending |
| 08-01-XX | 01 | 1 | MCP-02 | — | Initialized repo: starts, stderr carries the D-01 startup line with correct repo path | integration (subprocess) | `node --test src/commands/mcp.test.js` | ❌ W0 | ⬜ pending |
| 08-01-XX | 01 | 1 | MCP-03 | — | Server stays alive while stdin open; exits cleanly (code 0, silent) on stdin close | integration (subprocess) | `node --test src/commands/mcp.test.js` | ❌ W0 | ⬜ pending |
| 08-01-XX | 01 | 1 | MCP-03 | — | Server exits cleanly on SIGINT without any `process.exit` reachable from `src/commands/mcp.js`'s post-bootstrap code | integration (subprocess, send SIGINT to child) | `node --test src/commands/mcp.test.js` | ❌ W0 | ⬜ pending |
| 08-02-XX | 02 | — | COST-01 | — | `cost --all` plain-text repeats per-session blocks + grand total across sessions | unit (compute() called directly) | `node --test src/commands/cost.test.js` | ❌ W0 (extend existing) | ⬜ pending |
| 08-02-XX | 02 | — | COST-01 | — | `cost --all --json` carries turns from every session via `listAllTurns({ noCache })` | unit (compute() called directly) | `node --test src/commands/cost.test.js` | ❌ W0 (extend existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are placeholders — the planner assigns final `{plan}-{task}` IDs.*

---

## Wave 0 Requirements

- [ ] `src/commands/mcp.test.js` — new file. Use `child_process.spawn` (not `spawnSync` — the process must stay alive while the test interacts with it), following the `BIN_PATH`/`makeTestRepo()` fixture conventions already established in `src/commands/compute-purity.test.js` and `src/helpers/test-repo.js`. Send a minimal JSON-RPC `initialize` message over the child's stdin, assert a JSON-RPC response with `result.serverInfo` on stdout, send `notifications/initialized`, then either close stdin or send SIGINT and assert clean exit (code 0, no stray stderr beyond the D-01 line). Use a bounded safety-net timeout (`child.kill('SIGKILL')`) so a hang can't block the suite — this exact pattern doesn't exist anywhere else in the repo yet.
- [ ] `src/commands/cost.test.js` — extend existing file with `--all` cases: two sessions in one fixture repo (via `startSession()`/`makeTurn()` from `src/helpers/turn-fixtures.js` called twice to produce two distinct `session_id`s), assert plain-text output contains two `Session: <id>` blocks in turn order plus a grand-total line, and assert `--json --all` output's `turns` array spans both sessions.
- [ ] Framework install: none — `node:test` is already in use project-wide.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real MCP client handshake (e.g. Claude Code's `claude mcp add`) | MCP-01 | A hand-built JSON-RPC fixture in `mcp.test.js` proves protocol compliance but not real-client interop; no real MCP client is available as an automated dependency in this sandbox | Register `git turn mcp` as an MCP server with a real client, confirm it connects and lists zero tools without error |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

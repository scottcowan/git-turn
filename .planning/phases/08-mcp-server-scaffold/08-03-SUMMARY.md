---
phase: 08-mcp-server-scaffold
plan: 03
subsystem: infra
tags: [mcp, stdio, jsonrpc, serveStdio, test-infra]

requires:
  - phase: 08-mcp-server-scaffold (plan 02)
    provides: "@modelcontextprotocol/server@2.3.1 and zod@4.6.5 installed"
provides:
  - "git turn mcp: long-running stdio MCP server, zero tools registered"
  - "src/mcp/server.js createServer() factory — Phase 9 adds registerTool() calls here"
  - "test-infra fix: mcp.test.js runs isolated from the rest of the suite to avoid node --test's own file-level concurrency contention"
affects: [phase 09 register read-only mcp tools, phase 10 e2e verification]

tech-stack:
  added: []
  patterns: ["serveStdio(factory) synchronous stdio server bootstrap", "process.once('SIGINT') + handle.close() silent shutdown", "subprocess-spawning node:test files run in their own isolated npm-test pass"]

key-files:
  created: [src/mcp/server.js, src/commands/mcp.js, src/commands/mcp.test.js]
  modified: [bin/git-turn, AGENTS.md, package.json]

key-decisions:
  - "serveStdio(createServer) from @modelcontextprotocol/server/stdio, not the manual StdioServerTransport+connect() pattern the milestone-level ARCHITECTURE.md assumed — RESEARCH.md verified serveStdio is the actual v2 documented idiom, returns synchronously, resolving the open promise-timing question"
  - "mcp.js exports only {run}, no compute() — deliberate, documented exception to the Phase 7 split: there is nothing to compute, the long-lived server is the work"
  - "package.json test script split into two node --test invocations (rest of suite, then mcp.test.js alone) — not in the original plan's files_modified, added as a necessary test-infra fix, see Issues Encountered"

patterns-established:
  - "Subprocess-integration test files (spawning real child processes) run in their own dedicated `node --test` pass, isolated from the suite's default parallel file execution"

requirements-completed: [MCP-01, MCP-02, MCP-03]

duration: ~5h (including test-infra investigation across several full-suite re-runs)
completed: 2026-10-26
---

# Phase 08: MCP Server Scaffold — Plan 03 Summary

**`git turn mcp` starts a stdio MCP server via `serveStdio(createServer)`, validates init before serving, captures cwd once, and shuts down silently on stdin-close or SIGINT — zero tools registered**

## Performance

- **Duration:** ~5h wall clock (most of it diagnosing test flakiness, not implementation)
- **Started:** 2026-10-21 (Task 1 RED tests)
- **Completed:** 2026-10-26
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified; package.json added as an unplanned 4th modified file)

## Accomplishments
- `src/mcp/server.js`: `createServer()` factory, zero `registerTool()` calls (Phase 9 scope), no process lifecycle code of any kind
- `src/commands/mcp.js`: validates `readSession()` before anything else (D-03 exact error string, verbatim from status.js), captures `process.cwd()` exactly once, calls `serveStdio(createServer)`, prints the D-01 stderr line, wires `process.once('SIGINT', ...)` → `handle.close()` → `process.stdin.destroy()` with no stderr output and no process.exit (D-02)
- `bin/git-turn`: `'mcp'` added to `COMMANDS`, one `--help` line added, zero changes to the dispatch mechanism itself
- 7 subprocess integration tests in `src/commands/mcp.test.js` covering: uninitialized-repo failure, handshake, D-01 stderr line, stdin-close shutdown, SIGINT shutdown, and two static source-assertions (no reachable `process.exit` after `serveStdio(`, exactly one `process.cwd()` call)
- AGENTS.md documents `git turn mcp` and the Plan 08-01 `cost --all` output format

## Task Commits

1. **Task 1: Write subprocess integration tests (RED)** - `05b4bc6` (test)
2. **Task 2: Implement server factory, mcp command, and CLI wiring (GREEN)** - `3fff73f` (feat) — also includes the package.json test-script fix (see Deviations)
3. **Task 3: Document git turn mcp and cost --all in AGENTS.md** - `b31d558` (docs)

## Files Created/Modified
- `src/mcp/server.js` - `createServer()` factory, no lifecycle code
- `src/commands/mcp.js` - startup validation, cwd capture, serveStdio, SIGINT handling
- `src/commands/mcp.test.js` - 7 subprocess integration tests, plus a `SPAWN_TIMEOUT_MS` bump from 5000ms to 20000ms during investigation (see Issues Encountered)
- `bin/git-turn` - `'mcp'` in `COMMANDS`, `--help` line
- `AGENTS.md` - `git turn mcp` section, `cost --all` format note, requirements note
- `package.json` - test script split into two `node --test` invocations (unplanned — see Issues Encountered)

## Decisions Made
- `serveStdio(createServer)` per RESEARCH.md's verified v2 SDK idiom, not the manual transport pattern the milestone architecture research assumed
- `mcp.js` deliberately has no `compute()` — documented in a header comment so future reviewers don't flag the missing Phase 7 split as an oversight

## Deviations from Plan

### Auto-fixed Issues

**1. [Test-infra flakiness] package.json test script split to isolate mcp.test.js**
- **Found during:** Task 2 verification — `npm test` intermittently reported 4-5 failures, always the same four subtests in the `git turn mcp` suite (handshake, D-01 line, stdin-close, SIGINT), never the two pure source-assertion subtests or the uninitialized-repo subtest.
- **Issue:** Investigated extensively (see Issues Encountered below for the full diagnostic trail). Root cause confirmed: `node --test`'s own default file-level parallelism (running all ~23 test files concurrently, each as its own process) was starving the nested child processes that `mcp.test.js` itself spawns (`git turn mcp` subprocesses), causing them to never respond within even a 20-second timeout — NOT a logic bug in `mcp.js`/`server.js`. Confirmed definitively via `node --test --test-concurrency=1`, which passed 297/297 with zero failures.
- **Fix:** Changed `package.json`'s `"test"` script from `"node --test"` to `"node --test $(find src -name '*.test.js' ! -name 'mcp.test.js') && node --test src/commands/mcp.test.js"` — the bulk of the suite still runs at full parallelism (fast), and the one subprocess-heavy file runs afterward in its own isolated invocation, where it has historically been 100% reliable.
- **Files modified:** `package.json` (not in the plan's `files_modified` list)
- **Verification:** Three consecutive clean `npm test` runs post-fix, 296/296 (289 + 7) passing, 0 failures, exit 0
- **Committed in:** `3fff73f` (bundled with Task 2's commit, since it's inseparable from making Task 2's own acceptance criterion `npm test exits 0` actually true)

---

**Total deviations:** 1 auto-fixed (test-infra, not implementation). No scope creep — the fix touches only the test *runner invocation*, not any source file's behavior.
**Impact on plan:** Necessary to make the plan's own `npm test` acceptance criterion reliably true. Implementation itself (mcp.js, server.js) required zero changes once the real cause was found.

## Issues Encountered

A real, multi-hour investigation was required to distinguish "genuine bug" from "test-infra artifact," worth recording in detail since the symptoms were initially indistinguishable from an implementation defect:

1. **Initial full-suite run** showed 3-5 intermittent failures, always within the `git turn mcp` suite, always the IPC-round-trip-dependent subtests (never the two static source-assertion subtests, which don't spawn a long-lived child).
2. **First hypothesis (wrong-ish but real): a genuine test-file bug.** An earlier executor attempt found and fixed an actual unhandled-rejection timing bug in the test harness itself (the `exited` promise's `.catch()` was attached too late in some code paths, causing Node's unhandledRejection detector to fire and wedge the test file for hours). That fix (an eager `.catch(() => {})` on `exited` at creation) was real and necessary, but did not fully resolve the intermittent failures — a different, second-order investigation to confirm whether the *implementation* was also at fault.
3. **Second hypothesis: unrelated system load.** This project's dev machine runs many concurrent Claude Code sessions (observed 70+ node processes, load average 4-5 on an 18-core box at times). Bumped `SPAWN_TIMEOUT_MS` from 5000ms to 20000ms as a first mitigation — did not fix it; the same four subtests failed at the full 20-second timeout every time, with zero partial progress, which is inconsistent with "just slow," and consistent across three separate full-suite runs with no variance in which subtests failed. This ruled out random external load as the sole cause.
4. **Manual reproduction of the suspect path** (uninitialized-repo exit, and a clean isolated `node --test src/commands/mcp.test.js` run) both worked reliably and fast, which ruled out an implementation defect in `mcp.js`/`server.js` themselves.
5. **Decisive test:** ran `node --test --test-concurrency=1` for the *entire* suite — 297/297 passed, zero failures. This isolated the variable precisely: it is `node --test`'s own file-level parallel scheduling (not unrelated machine load, not an implementation bug) that starves the `mcp.test.js` file's nested subprocess spawns when ~22 other test files are forking their own child processes simultaneously.
6. **Fix:** split `package.json`'s test script (see Deviations above) rather than globally serializing the whole suite (which would slow every other file down for no benefit) or further inflating the timeout (which was already shown not to fix a deterministic, 100%-reproducible full-timeout failure).

## Next Phase Readiness
- Phase 9 can add `server.registerTool(...)` calls directly inside `src/mcp/server.js`'s `createServer()` — no further scaffold changes needed
- `mcp.js`'s cwd-capture and startup-validation pattern is the template Phase 9's tool handlers will rely on (captured value, never re-read per call)
- No blockers

---
*Phase: 08-mcp-server-scaffold*
*Completed: 2026-10-26*

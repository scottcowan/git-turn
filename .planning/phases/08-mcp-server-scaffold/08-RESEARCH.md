# Phase 8: MCP Server Scaffold - Research

**Researched:** 2026-10-21
**Domain:** stdio MCP server bootstrap (zero tools) on top of an existing synchronous CLI dispatcher, plus a cross-session cost aggregation bug fix
**Confidence:** HIGH (package API verified directly against the installed-version package contents and official v2 docs; one architecture-level correction to milestone research, documented below)

## Summary

The milestone-level research (`ARCHITECTURE.md`/`PITFALLS.md`/`STACK.md`) already locked the big calls for this phase: take `@modelcontextprotocol/server@2.3.1` + `zod` as git-turn's first runtime dependencies, capture cwd once at startup, never call `process.exit()` from code reachable by a tool handler, reuse `listAns Turns`-style cross-session helpers for `cost --all`. This research verifies the exact API surface against the real installed package and corrects one load-bearing assumption: **`@modelcontextprotocol/server@2.3.1` is v2 of the SDK** (implementing the 2026-07-28 MCP spec), and v2's documented, recommended stdio idiom is `serveStdio(factory)` from `@modelcontextprotocol/server/stdio` — not the manual `new StdioServerTransport(); await server.connect(transport)` pattern the milestone's Pattern 3 described and flagged as a MEDIUM-confidence open question. `serveStdio()` is **synchronous** — it returns a `StdioServerHandle` object immediately (not a promise), and the process survives naturally because the transport keeps a stdin listener alive, not because `mcp.js`'s `run(args)` awaits anything. This resolves Pattern 3's open question definitively for the v2 package actually being installed: there is no "does the promise resolve at handshake or at close" question for the recommended path, because there's no long-lived promise in the loop at all.

The manual `StdioServerTransport` + `server.connect()` pattern still exists in `v2.3.1` (both are exported from the `/stdio` subpath) and would still work, but `serveStdio()` is the officially documented idiom, requires less boilerplate, and its lifecycle (factory function → handle with `.close()`) maps cleanly onto git-turn's existing `run(args)` dispatch contract without needing to introduce a new promise-awaiting branch in `bin/git-turn` at all. **Recommendation: use `serveStdio()`, not the manual transport pattern.**

**Primary recommendation:** Build `src/commands/mcp.js` around `serveStdio(() => new McpServer({ name: 'git-turn', version }))`, validating repo init and capturing `process.cwd()` synchronously *before* calling `serveStdio()`, registering an app-level `process.on('SIGINT', () => void handle.close())`, and printing the D-01 stderr line immediately after `serveStdio()` returns (not gated on the client's `initialize` handshake — `serveStdio()`'s return is synchronous, so "after the stdio transport connects" is satisfied as soon as the call returns).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Repo-init validation (MCP-02) | CLI/process bootstrap (`src/commands/mcp.js`) | — | Same tier as every other command's `readSession()` check; must run before any server/transport object is constructed |
| cwd capture (MCP-02) | CLI/process bootstrap | — | `process.cwd()` is immutable for process lifetime; capturing once at the very top of `run(args)` is correctness-critical, not stylistic |
| stdio transport lifecycle (MCP-01, MCP-03) | MCP server library (`@modelcontextprotocol/server/stdio`) | CLI/process bootstrap (SIGINT wiring) | The SDK owns framing/handshake/EOF-close; git-turn owns the one thing the SDK leaves optional — SIGINT → `handle.close()` |
| Tool registration | N/A this phase | — | Explicitly zero tools registered in Phase 8; `McpServer` instance is constructed with no `registerTool` calls |
| `cost --all` cross-session aggregation (COST-01) | Command/compute layer (`src/commands/cost.js`) | Cross-session helper (`src/blame-util.js`'s `listAllTurns`) | Same tier as `blame`/`bisect`/`heatmap`'s existing use of `listAllTurns` — no new helper needed |

## Project Constraints (from CLAUDE.md)

No project-local `./CLAUDE.md` exists in this repo (only the user's global `~/.claude/CLAUDE.md`, which is a communication-style preference — absolute clock times — with no bearing on this phase's implementation). `AGENTS.md` (the project's checked-in agent reference) documents existing CLI behavior but imposes no additional constraints beyond what's already captured in CONTEXT.md/REQUIREMENTS.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (startup feedback):** On successful startup (after the stdio transport connects), `git turn mcp` prints one line to stderr, e.g. `git turn mcp: server started, scoped to <repo-path>`. MCP clients only read stdout for JSON-RPC and ignore stderr, so this is always safe to print.
- **D-02 (shutdown behavior):** On clean shutdown (stdin closes, or SIGINT), the server exits silently — no stderr message, exit code 0. No symmetry requirement with the startup message; chosen to avoid any risk of a stray write racing stdio teardown.
- **D-03 (uninitialized-repo error wording, MCP-02):** Reuse the exact existing CLI string verbatim: `` git turn: not initialized. Run `git turn init` first. `` — the same text `readSession()` returning null already produces in `cost.js`/`status.js`/etc. No new error string to introduce or keep in sync.
- **D-04 (cost --all display format, COST-01):** Plain-text `cost --all` output repeats today's single-session format (header `Session: <id>` + table + per-session subtotal) once per session, in turn order — minimal diff to the existing renderer in `src/commands/cost.js`, just loop it across `listAllTurns({ noCache })`'s sessions instead of `listTurns()`'s single session. A grand total across all sessions prints at the very end, after the last per-session block. `--json` already carries `session_id` per turn regardless of this choice (Phase 7 already shipped that shape) — this decision only affects the plain-text renderer.

### Claude's Discretion

- Exact phrasing/formatting of the D-01 startup line and the grand-total line in D-04 (beyond the examples given) — implementation detail, not locked to the literal example text.
- Whether `src/mcp/server.js` is split from `src/commands/mcp.js` as its own file (per ARCHITECTURE.md's "optional split") — defer to planner/executor judgment; both are equally valid per research.

### Deferred Ideas (OUT OF SCOPE)

- Registering the five read-only tools (`git_turn_log`/`_show`/`_diff`/`_blame`/`_cost`) — Phase 9, not this phase.
- Claude Code Stop-hook for automatic `record-prompt` capture — unrelated, tracked as its own todo.
- `git_turn_revert`/`bisect`/`redact`/`record-prompt` as MCP tools — blocked on an MCP confirmation/elicitation pattern that doesn't exist yet; Future Requirements, not this milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | `git turn mcp` starts a stdio MCP server implementing `initialize`/`notifications/initialized`/`tools/list`/`tools/call`, scoped to cwd's repo | `serveStdio()` + `McpServer` handle the full handshake/`tools/list`/`tools/call` surface out of the box (even with zero tools registered, `tools/list` returns `{tools: []}` and `tools/call` on an unknown name returns a protocol-level error) — confirmed via package exports and official docs below. Repo scoping comes from `process.cwd()` being read once by `src/git.js`'s existing helpers, unchanged. |
| MCP-02 | Validate at startup that cwd is git-turn-initialized, fail loudly on stderr if not, never re-read cwd per call | Reuse `readSession()` from `src/session.js` (already null-checked by `status.js`/`cost.js`/etc.) as a synchronous pre-check *before* `serveStdio()` is called; capture `const repoPath = process.cwd()` once, pass only that captured value (never re-call `process.cwd()`) into the D-01 message and any future tool-handler context. |
| MCP-03 | Server stays alive until stdio closes, exits cleanly on stdin-close or SIGINT | `serveStdio()`'s internal stdin reader is what keeps the event loop alive — no `setInterval`/manual keep-alive needed. Stdin EOF is handled by the SDK automatically (per official docs, verified below). SIGINT needs one line of application code (`process.on('SIGINT', () => void handle.close())`) — the SDK does not install this itself. |
| COST-01 | `cost --all` reports across all sessions using `listAllTurns({ noCache })`, same pattern as `blame`/`bisect`/`heatmap` | Verified `src/commands/cost.js`'s exact current structure (reads `args.includes('--all')` into `allSessions`, never used) and `src/blame-util.js`'s `listAllTurns` return shape (`{session_id, turn_n, snapshot_sha, head_sha, branch, ts}` — already resolved head_sha, no need to re-call `parseSnapshotMessage`). Concrete refactor shape given below. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@modelcontextprotocol/server` | `2.3.1` [VERIFIED: npm registry + official docs ts.sdk.modelcontextprotocol.io] | MCP server construction (`McpServer`) + stdio transport (`serveStdio`, `StdioServerTransport`) | Official Anthropic-maintained v2 SDK package; already the locked choice from milestone research; verified here by unpacking the actual `.tgz` and reading `dist/stdio.cjs`'s exports plus the official v2 docs site |
| `zod` | `4.6.5` pinned per milestone research; `4.6.7` is current on the registry as of this session [VERIFIED: npm registry] | Tool input schema authoring (`z.object(...)`) — required even with zero tools this phase because `McpServer`'s `registerTool` config type expects a Zod schema, and `package.json` needs the direct dependency pinned now so Phase 9 doesn't have to revisit it | Required peer of `@modelcontextprotocol/server@2.3.1` (`^4.2.0`); official docs show both `require('zod/v4')` and bare `zod` import forms — this package's root export is already Zod v4, so `require('zod')` works, but the official examples explicitly use `require('zod/v4')`/`import * as z from 'zod/v4'` for forward-compatibility across zod's own v3/v4 coexistence; **recommend matching the docs' `zod/v4` subpath import** even though Phase 8 itself writes no schemas (keeps the convention consistent for Phase 9, which will) |

### Supporting

None — no additional packages needed for a zero-tool scaffold. `zod` is listed under Core rather than Supporting because `package.json` must declare it now (peer requirement), even though Phase 8's own code doesn't call `z.object()` anywhere yet.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `serveStdio(factory)` (recommended) | Manual `new StdioServerTransport(); await server.connect(transport)` | Still supported in v2.3.1 (both exported from `/stdio`), and is what the *milestone-level* research assumed — but it's the superseded v1 idiom per the v2 docs ("serveStdio replaces the new StdioServerTransport() + server.connect() wiring"). Using it would reintroduce the exact "does the promise resolve at handshake or close" ambiguity this research exists to resolve, for no benefit. No reason to choose it over `serveStdio()` for this phase. |
| `@modelcontextprotocol/server` v2 | `@modelcontextprotocol/sdk` v1 (legacy) | Already rejected by milestone research — 17 transitive deps (Express, Hono, jose, ajv, etc.) vs. v2's `zod`-only footprint. Not reconsidered here; v2's `serveStdio` finding only strengthens the v2 choice (simpler stdio lifecycle too). |

**Installation:**
```bash
npm install @modelcontextprotocol/server@2.3.1 zod@4.6.5
```

**Version verification:** Ran directly against the live npm registry this session:
```
npm view @modelcontextprotocol/server version dependencies peerDependencies
# version = '2.3.1'; dependencies = { zod: '^4.2.0', '@modelcontextprotocol/core': '2.3.1' }
npm view zod version
# 4.6.7 (current on registry; milestone research pinned 4.6.5, still satisfies ^4.2.0 peer — either is fine, no urgency to bump)
```
Also unpacked `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/core@2.3.1`, and `zod@4.6.5` via `npm pack` into a scratch directory and inspected `package.json`/`dist/*.cjs`/`dist/*.d.cts`/`README.md` directly — not just registry metadata. Confirmed: `"type": "module"` with a dual CJS/ESM `"exports"` map (`require()` works cleanly from git-turn's existing CommonJS codebase, no build step, no `"type": "module"` migration needed anywhere in git-turn).

## Package Legitimacy Audit

> slopcheck could not be installed in this sandboxed environment (pip install was denied as untrusted-code execution). Per the graceful-degradation protocol, both packages below are tagged `[ASSUMED]` and the planner **must** gate each `npm install` behind a `checkpoint:human-verify` task, despite the strong corroborating evidence gathered by other means (listed in the table).

| Package | Registry | Age | Downloads (wk) | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------------|--------------|-----------|-------------|
| `@modelcontextprotocol/server` | npm | created 2026-04-01, last modified 2026-10-05 (~7 months old, actively maintained) | 8,202,973 | `github.com/modelcontextprotocol/typescript-sdk` (official Anthropic org) | not run — [ASSUMED] | Approved, pending human verification checkpoint |
| `zod` | npm | created 2020-03-07 (~6.5 years old) | 207,048,213 | `github.com/colinhacks/zod` | not run — [ASSUMED] | Approved, pending human verification checkpoint |
| `@modelcontextprotocol/core` | npm (transitive, not directly installed) | created 2026-06-25, last modified 2026-10-05 | n/a (transitive) | same org, same repo | not run — [ASSUMED] | Transitive only, approved pending checkpoint |

**Packages removed due to slopcheck [SLOP] verdict:** none — slopcheck did not run.
**Packages flagged as suspicious [SUS]:** none, but see note above — all three are `[ASSUMED]`, not `[VERIFIED]`, because the npm-registry/download/repo checks above (while reassuring — official `modelcontextprotocol`/`anthropic` GitHub org, 8M+ weekly downloads, matches the exact package name independently cited by official MCP documentation at `ts.sdk.modelcontextprotocol.io`) do not substitute for slopcheck per the stated provenance rule. The planner should add a `checkpoint:human-verify` immediately before the `npm install` task.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP client (e.g. Claude Code) spawns `git turn mcp` as subprocess │
└───────────────────────────────┬───────────────────────────────────┘
                                 │ stdin/stdout (JSON-RPC 2.0, newline-framed)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ bin/git-turn  — unmodified dispatch: require('src/commands/mcp')  │
│                  .run(args)                                       │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ src/commands/mcp.js  run(args)                                    │
│  1. readSession() — null? print D-03 string to stderr, exit 1     │
│     (never reaches serveStdio — "fails loudly, no server left     │
│      running", MCP-02 success criterion #2)                       │
│  2. const repoPath = process.cwd()  — captured ONCE here           │
│  3. handle = serveStdio(() => new McpServer({name,version}))       │
│     (synchronous call — returns StdioServerHandle immediately)     │
│  4. process.stderr.write(D-01 line with repoPath)                  │
│  5. process.on('SIGINT', () => void handle.close())                │
│  6. run(args) returns — no promise. Node's event loop stays alive  │
│     because serveStdio() installed a stdin listener internally.    │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
            ┌────────────────────────────────────┐
            │ @modelcontextprotocol/server/stdio    │
            │  handles: initialize, notifications/  │
            │  initialized, tools/list (→ []),      │
            │  tools/call (→ protocol error, no     │
            │  tools registered this phase),        │
            │  stdin-EOF → auto transport close,     │
            │  handle.close() → graceful teardown    │
            └────────────────────────────────────┘
                                 │
                        (Phase 9: tool handlers
                         registered here, calling
                         src/commands/*.js compute())
```

### Recommended Project Structure

```
src/
├── commands/
│   └── mcp.js            # NEW: `git turn mcp` CLI entry — run(args) only, no compute()
│                          #      (nothing to "compute" yet — no tools, no return value)
├── mcp/                   # NEW (optional split, Claude's discretion per CONTEXT.md)
│   └── server.js          # NEW (optional): factory wrapping `new McpServer({...})`,
│                           #      kept separate so Phase 9 can add `registerTool` calls
│                           #      here without touching mcp.js's bootstrap/SIGINT code
└── commands/
    └── cost.js             # MODIFIED: wire `allSessions` into `listAllTurns`, loop per
                             #           session for plain-text (D-04), unchanged --json shape
```

### Pattern 1: `serveStdio(factory)` — the v2-recommended stdio lifecycle

**What:** `serveStdio()` takes a zero-arg factory function that constructs and returns an `McpServer` instance; it owns transport creation/connection internally and returns a `StdioServerHandle` **synchronously** (not a promise). The handle has one documented method, `close()`, which returns a promise that resolves once the server instance and transport have fully shut down.

**When to use:** Always, for this phase and Phase 9 — it's the officially documented idiom for stdio servers in `@modelcontextprotocol/server@2.3.1` (v2), superseding the manual `new StdioServerTransport(); await server.connect(transport)` pattern from v1 / the legacy `@modelcontextprotocol/sdk`.

**Example (CommonJS, matches git-turn's existing module style):**
```js
// Source: official docs, https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio
// (CommonJS section, fetched 2026-10-21)
const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'git-turn', version: '0.1.0' });
  // No server.registerTool(...) calls this phase — zero tools (Phase 8 scope).
  return server;
});
```

**Logging:** `console.error(...)` only — stdout is reserved exclusively for JSON-RPC framing. This matches PITFALLS.md's Pitfall 1/2 exactly and confirms the official guidance agrees with that milestone-level finding.

**SIGINT (application's responsibility, not the SDK's):**
```js
// Source: official docs, same page
process.on('SIGINT', () => {
  void handle.close();
});
```
The docs show this as explicitly optional application code, not something `serveStdio()` installs automatically — confirms PITFALLS.md's framing that the server bootstrap code (not the SDK) owns SIGINT-to-graceful-shutdown wiring. **Without this handler, Node's own default SIGINT behavior terminates the process anyway** (so MCP-03's "exits cleanly on SIGINT" is satisfied even with zero extra code), but adding the explicit handler + `handle.close()` gives a documented graceful-teardown path matching D-02's "exit code 0, no stderr message" requirement more reliably than relying on Node's default signal termination (which can exit with code 130 depending on how the process is invoked by the parent). **Recommend adding the explicit handler.**

**stdin-EOF (handled automatically by the SDK):** Per official docs — "When the client closes its end (stdin reaches end-of-file), the transport closes itself and the connection tears down automatically." No application code needed for this path; this directly satisfies "exits cleanly when stdin closes" in MCP-03 with zero additional code.

### Pattern 2: Startup validation happens *before* `serveStdio()`, never inside a tool handler

**What:** `src/commands/mcp.js`'s `run(args)` calls `readSession()` (from `src/session.js` — the exact same helper `status.js`/`cost.js`/`blame.js` already use) synchronously as the very first statement. If it returns `null`, print D-03's exact string to stderr and `process.exit(1)` — *before* `serveStdio()` is ever called, so no server process is left running (MCP-02 success criterion #2's literal wording).

**When to use:** This phase's entire bootstrap sequence.

**Example:**
```js
// src/commands/mcp.js — shape, not final code
'use strict';
const { readSession } = require('../session');
const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.'); // D-03, verbatim
    process.exit(1);
    return;
  }

  const repoPath = process.cwd(); // captured ONCE — never re-read per tool call (MCP-02)

  const handle = serveStdio(() => new McpServer({ name: 'git-turn', version: require('../../package.json').version }));

  process.stderr.write(`git turn mcp: server started, scoped to ${repoPath}\n`); // D-01

  process.on('SIGINT', () => { void handle.close(); }); // D-02: handle.close() tears down silently
}

module.exports = { run };
```
Note: `mcp.js` exports only `run` — there is no `compute()` to split out this phase (nothing to compute; the "work" is the long-lived server itself). This is a deliberate, narrow exception to the compute/run convention established in Phase 7, and should be called out as such rather than forced into a shape that doesn't fit (e.g. don't invent a no-op `compute()` just for symmetry).

### Pattern 3: `bin/git-turn`'s existing dispatch needs **zero changes** beyond `COMMANDS` + `--help`

**What:** Because `serveStdio()` is synchronous and `run(args)` above returns `undefined` (not a promise), `bin/git-turn`'s existing promise-aware dispatch branch (`if (result && typeof result.then === 'function') result.catch(...)`) simply doesn't trigger for `mcp` — which is correct and requires no modification. This is a **correction to milestone research**, which assumed `mcp.js`'s `run(args)` would return the long-lived `server.connect(transport)` promise and rely on that dispatch branch to await it. With `serveStdio()`, there is no promise to return; the process stays alive because `serveStdio()` internally keeps a stdin listener registered, which is what keeps Node's event loop alive — not anything `bin/git-turn` or `mcp.js`'s `run()` return value does.

**When to use:** This phase's `bin/git-turn` edit is limited to: add `'mcp'` to the `COMMANDS` array (line 8) and one line to the `--help` text block. No dispatch-mechanism change needed.

### Anti-Patterns to Avoid

- **Using the manual `StdioServerTransport` + `server.connect()` pattern:** Still present in `v2.3.1`'s exports, and what the milestone research assumed, but superseded by `serveStdio()` per the official v2 docs. Using it reopens the exact "when does the promise resolve" ambiguity this research was tasked with resolving, for a worse (undocumented-as-primary) API.
- **Treating `run(args)`'s lack of a return value as a bug to "fix" by wrapping `serveStdio()` in a `new Promise(() => {})` that never resolves:** Unnecessary — `bin/git-turn`'s dispatcher is fine with an `undefined` return (the thenable check is just skipped), and a never-resolving promise adds an unhandled-rejection/memory-retention risk for no benefit.
- **Gating the D-01 stderr line on the MCP client's `initialize` handshake completing:** CONTEXT.md's D-01 says "after the stdio transport connects," and `serveStdio()`'s synchronous return already represents "transport connected" (it has set up the stdin reader) — there's no documented hook to await the handshake specifically, and doing so would need subscribing to an internal event not exposed as a stable public API. Print immediately after `serveStdio()` returns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| JSON-RPC 2.0 framing, `initialize`/`notifications/initialized` handshake, `tools/list`/`tools/call` dispatch | A hand-rolled `readline`-based stdio loop (this was STACK.md's *original*, now-superseded recommendation, written before `@modelcontextprotocol/server` v2's narrow footprint was discovered) | `@modelcontextprotocol/server` + `serveStdio()` | Already corrected at the milestone-research level (ARCHITECTURE.md's override note) — re-confirmed here: the package's dependency footprint is `zod` only (plus its own `@modelcontextprotocol/core`), no HTTP stack, so the original "hand-roll to avoid 17 transitive deps" argument against `@modelcontextprotocol/sdk` v1 does not apply to v2's `/server` package |
| SIGINT → graceful shutdown ordering, stdin-EOF detection | A manual `process.stdin.on('end', ...)` + custom `close()` sequencing | `serveStdio()`'s built-in EOF handling + the one-line documented `process.on('SIGINT', () => void handle.close())` pattern | The SDK already implements the EOF path; only SIGINT needs application code, and the correct shape is already documented — no design work needed, just copy the pattern |
| Cross-session turn enumeration for `cost --all` | A new helper function scanning `refs/git-turn/sessions/**` directly from `cost.js` | `src/blame-util.js`'s existing `listAllTurns({ noCache })` | Exact same helper `blame.js`/`bisect.js`/`heatmap.js` already call; building a second implementation would be the "two sha-resolution helpers" bug class PITFALLS.md's Pitfall 5 explicitly warns against |

**Key insight:** Every "don't hand-roll" item in this phase has already been correctly identified at the milestone level — this phase's research confirms there's no new discovery needed, only exact API verification against the real package.

## Common Pitfalls

### Pitfall 1: Assuming `server.connect()`'s promise timing matters for this package version

**What goes wrong:** Building `mcp.js` around a manual `await server.connect(transport)` call, then writing tests or SIGINT logic that assume the returned promise only resolves at transport close (per the milestone research's flagged MEDIUM-confidence assumption) — when in fact the *recommended* `serveStdio()` path has no such promise at all.
**Why it happens:** The milestone-level ARCHITECTURE.md was written against npm registry metadata, not the actual unpacked package + its official v2 docs, and reasonably assumed the "every MCP SDK works the same way" default (manual transport + connect). v2 changed this.
**How to avoid:** Use `serveStdio()`, not manual `connect()`. If a future reason ever requires the manual pattern (e.g. needing a reference to the raw `Server` instance for something `McpServer` doesn't expose), verify its promise-resolution timing empirically with a minimal smoke script before relying on it, rather than assuming either timing.
**Warning signs:** Any code path in `mcp.js` that does `const transport = new StdioServerTransport(); await server.connect(transport);` — this is the exact pattern this research recommends against.

### Pitfall 2: `readSession()`'s cwd-dependence means test fixtures must `process.chdir()`, not just pass a `cwd` option

**What goes wrong:** Writing a test for MCP-02 that spawns `git turn mcp` with a `cwd` option in `spawnSync`/`spawn` but doesn't realize `readSession()` (via `gitDir()`) genuinely does read from the subprocess's own working directory — this is correct and will work, but a *unit* test (not subprocess test) calling `mcp.js`'s `run()` in-process without `process.chdir()`-ing into a fixture repo first will silently validate against the test runner's own repo instead of the intended fixture.
**Why it happens:** Every other command's tests already handle this correctly (see `compute-purity.test.js`'s `beforeEach`/`afterEach` `process.chdir()` pattern) — but `mcp.js` is new code, and it's easy to write its test differently (e.g. spawning via `child_process.spawn` with a `cwd:` option) without realizing in-process unit tests need the chdir pattern instead.
**How to avoid:** For subprocess-based tests (recommended for this phase — see Validation Architecture below), pass `cwd: dir` directly to `spawn`, which is correct and doesn't need `process.chdir()` in the test process itself. For any in-process unit test of `run()` logic, follow `compute-purity.test.js`'s existing `beforeEach: process.chdir(dir)` / `afterEach: process.chdir(origCwd)` pattern exactly.
**Warning signs:** A test that passes trivially regardless of which fixture directory is used — a sign it's accidentally validating against the real git-turn repo's own session state.

### Pitfall 3: Forgetting that `serveStdio()`'s factory itself must stay process.exit-free

**What goes wrong:** Phase 8 registers zero tools, but the factory function passed to `serveStdio()` is still "code reachable while the server is live" — if a future edit (even in this phase, e.g. adding a version-lookup that throws) calls `process.exit()` inside the factory or anywhere `serveStdio()`'s internals might re-invoke it, that's the same server-killing hazard Pitfall 3 in the milestone PITFALLS.md describes, just moved one level up the call stack (bootstrap code, not a tool handler).
**Why it happens:** Phase 8's own success criteria (#3) explicitly calls this out: "without being killed by any `process.exit` call reachable from its code path" — this is a phase-8-specific acceptance bar, not deferred to Phase 9.
**How to avoid:** Treat the pre-existing project-wide convention (`grep -r process.exit src/mcp/` returning nothing) as applying to `src/commands/mcp.js` too, with the one explicit, deliberate exception being the top-of-`run()` `readSession()` null-check's `process.exit(1)` — which fires *before* `serveStdio()` is ever called, so no server is alive at that point. Everything *after* `serveStdio()` returns must be exit-free.
**Warning signs:** Any `process.exit()` call textually located after the `serveStdio()` call in `mcp.js`.

### Pitfall 4: `cost.js`'s existing per-turn loop reads `sha` and re-derives `head_sha` via `parseSnapshotMessage` — `listAllTurns()` already did that

**What goes wrong:** A naive COST-01 implementation that loops `listAllTurns({ noCache })`'s results but keeps calling `parseSnapshotMessage(sha)` on each entry (copy-pasting the existing single-session loop body verbatim) would be calling `parseSnapshotMessage` on data that's already been through it — `listAllTurns()`'s returned objects already carry a resolved `head_sha` field directly (confirmed by reading `src/blame-util.js:53-62`), not a raw `sha` needing re-resolution. The existing single-session loop in `cost.js` reads `{ turn_n, sha }` from `listTurns()` (which does *not* pre-resolve — confirmed `src/session.js:107-116`, returns `{turn_n, ref, sha}` with `sha` being the raw snapshot sha), so the two source shapes genuinely differ and a verbatim copy-paste of the loop body across them silently uses the wrong field name (`sha` vs `head_sha`) or double-resolves.
**Why it happens:** `listTurns(sessionId)` and `listAllTurns({noCache})` look similar ("list the turns") but return differently-shaped objects — one pre-resolves `head_sha`, the other doesn't — because `listAllTurns` was built for cross-session consumers (`blame`/`bisect`/`heatmap`) that always need `head_sha` immediately, while `listTurns` was built for `cost.js`'s existing single-session path which resolves per-turn lazily inside its own loop.
**How to avoid:** When writing the `--all` branch, use `turn.head_sha` directly from each `listAllTurns()` result — do not call `parseSnapshotMessage()` again on it. Only the non-`--all` branch (still using `listTurns()`) needs the existing `parseSnapshotMessage(sha)` call preserved as-is.
**Warning signs:** A `cost --all` smoke test whose token/cost numbers are empty or wrong even though `cost` (no `--all`) reports correctly on the same session — a sign the `--all` path is resolving (or failing to resolve) `head_sha` differently than expected.

## Code Examples

### COST-01: concrete refactor shape for `cost.js`'s `compute()`

```js
// src/commands/cost.js — shape of the --all branch, D-04 plain-text format
// Source: direct reading of src/commands/cost.js (existing single-session loop)
//         + src/blame-util.js's listAllTurns (already-resolved head_sha field)
async function compute(args, opts = {}) {
  const session = readSession();
  if (!session) throw new Error('git turn: not initialized. Run `git turn init` first.');

  const allSessions = args.includes('--all');
  const wantJson = args.includes('--json');
  // ... pricing load unchanged ...

  if (allSessions) {
    const { listAllTurns } = require('../blame-util');
    const turns = listAllTurns({ noCache: args.includes('--no-cache') });

    // Group by session_id, preserving the turn-order listAllTurns already provides
    const bySession = new Map();
    for (const t of turns) {
      if (!bySession.has(t.session_id)) bySession.set(t.session_id, []);
      bySession.get(t.session_id).push(t);
    }

    if (wantJson) {
      // Flat jsonTurns array across all sessions — session_id already
      // present per turn (Phase 7 JSON-01 shape), no restructuring needed.
      // ... build using t.head_sha directly, NOT parseSnapshotMessage(t.snapshot_sha) ...
    }

    const lines = [];
    let grandTotal = 0;
    let grandTurnsWithCost = 0;
    for (const [sessionId, sessionTurns] of bySession) {
      // Reuse the exact existing single-session rendering logic (header,
      // table, per-session subtotal) — just feed it sessionTurns with
      // t.head_sha already resolved instead of re-deriving via
      // parseSnapshotMessage(t.snapshot_sha).
      // ... push `Session: ${sessionId}` + table + subtotal to `lines` ...
      // accumulate grandTotal / grandTurnsWithCost here
    }
    lines.push(`\nGrand total across ${bySession.size} sessions: $${grandTotal.toFixed(4)}`); // D-04, Claude's discretion on exact wording
    return lines.join('\n');
  }

  // ... existing single-session branch unchanged, still using listTurns() + parseSnapshotMessage(sha) ...
}
```

### MCP scaffold: full `mcp.js` shape (combining Patterns 1-3 above)

See Pattern 2's code example above — it is the complete recommended shape for this phase; no additional example needed beyond what's already shown.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|--------------------|---------------|--------|
| `@modelcontextprotocol/sdk` monolithic package, manual `new StdioServerTransport(); await server.connect(transport)` | `@modelcontextprotocol/server` (v2, modular) + `serveStdio(factory)` | v2 SDK release (2026-04-01 per npm `time.created`), implementing the 2026-07-28 MCP spec | Milestone research already caught the package-choice half of this change (`STACK.md`'s override note); this phase's research catches the *stdio-lifecycle* half — `serveStdio()` vs. manual `connect()` — which the milestone research didn't drill into |

**Deprecated/outdated:** The manual `StdioServerTransport` + `server.connect()` pattern is not removed in `v2.3.1` but is explicitly described by the official docs as superseded by `serveStdio()` for the common case. Do not treat its continued presence in the package's exports as an endorsement to use it over `serveStdio()`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | `@modelcontextprotocol/server`, `@modelcontextprotocol/core`, and `zod` are legitimate, non-slopsquatted packages | Package Legitimacy Audit | If wrong, a malicious/typosquatted package becomes git-turn's first runtime dependency; mitigated by requiring a `checkpoint:human-verify` before `npm install` — the registry age/download/repo evidence gathered here is reassuring but not a substitute for that human check |
| A2 | `serveStdio()`'s return value genuinely keeps Node's event loop alive via an internal stdin listener (not via some other undocumented mechanism that might behave differently under e.g. `--no-warnings` or specific Node 22 minor versions) | Pattern 1, Architecture Patterns | If wrong, `git turn mcp` could exit immediately after `run(args)` returns instead of staying alive — this is testable directly (see Validation Architecture below) and should be the first thing the Wave 0 smoke test confirms before building anything else on top of it |
| A3 | Printing the D-01 stderr line immediately after `serveStdio()` returns (rather than after the client's `initialize` handshake) satisfies CONTEXT.md's D-01 wording ("after the stdio transport connects") | Pattern 2, Anti-Patterns | Low risk — if the discuss-phase author actually meant "after handshake completes," the fix is a small code change (subscribe to whatever internal event fires on `notifications/initialized`, if one is exposed) rather than a design problem; worth a quick confirm with the user during planning if ambiguity matters |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Does `McpServer`'s public API expose a stable hook for "client's `initialize`/`notifications/initialized` handshake completed" (as opposed to just "transport connected")?**
   - What we know: `serveStdio()` returns synchronously once the transport is wired up; the actual JSON-RPC handshake with a real client happens asynchronously after that, driven by whatever the client sends first.
   - What's unclear: Whether there's a documented `server.oninitialized` or similar event (by analogy to the documented `server.server.onclose` shown in the Keep-Alive example) that could be used if a future requirement needs to gate behavior specifically on handshake completion rather than transport connection.
   - Recommendation: Not needed for Phase 8 (D-01's stderr line doesn't require this precision, per Pattern 2 above) — only worth investigating if a future phase's acceptance criteria explicitly require "after handshake" semantics.

2. **Exact behavior of `tools/call` against an unregistered tool name, with zero tools registered — confirmed shape of the protocol-level error response?**
   - What we know: `McpServer` handles `tools/list`/`tools/call` dispatch internally; with zero `registerTool()` calls, `tools/list` should return `{tools: []}`.
   - What's unclear: The exact JSON-RPC error code/message `tools/call` returns for an unknown tool name when the tool set is empty — not independently confirmed against the real client in this session (would require an actual MCP client round-trip, which is Phase 10's VERIFY-04 scope, not Phase 8's).
   - Recommendation: Not blocking for Phase 8 (success criterion #1 only requires the `initialize`/`notifications/initialized` handshake to complete, not `tools/call` behavior) — defer verification to Phase 9/10 where tools actually exist to call.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | entire project | ✓ | engines requires >=22; `@modelcontextprotocol/server` requires >=20 (compatible) | — |
| npm registry access | installing `@modelcontextprotocol/server`/`zod` | ✓ (confirmed — `npm view`/`npm pack` succeeded live this session) | — | — |
| A real MCP client (Claude Code or similar) for manual smoke-testing | Phase 8's own manual verification step (per ARCHITECTURE.md's Build Order Phase B acceptance check) | not verified in this research session — assume available to the human operator, not to this sandboxed research process | — | A hand-written minimal JSON-RPC stdin/stdout script (see Validation Architecture below) can substitute for automated test purposes; a real client is still recommended for at least one manual check before considering the phase done |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** real MCP client for manual verification — automated tests use a hand-rolled JSON-RPC stdin/stdout harness instead (see below); a manual check with a real client remains recommended before closing the phase.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in), `node:assert/strict` — confirmed from `package.json`'s `"test": "node --test"` and every existing `*.test.js` file |
| Config file | none — `node --test` auto-discovers `**/*.test.js` |
| Quick run command | `node --test src/commands/mcp.test.js` (once created) / `node --test src/commands/cost.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|----------------------|--------------|
| MCP-01 | `git turn mcp` completes `initialize`/`notifications/initialized` handshake with a real-shaped JSON-RPC client | integration (subprocess) | `node --test src/commands/mcp.test.js` | ❌ Wave 0 |
| MCP-02 | Uninitialized repo: loud stderr, exit nonzero, no lingering process | integration (subprocess) | same file | ❌ Wave 0 |
| MCP-02 | Initialized repo: starts, stderr carries D-01 line with correct repo path | integration (subprocess) | same file | ❌ Wave 0 |
| MCP-03 | Server stays alive while stdin open; exits cleanly (code 0, silent) on stdin close | integration (subprocess) | same file | ❌ Wave 0 |
| MCP-03 | Server exits cleanly on SIGINT without hitting `process.exit` inside `src/mcp*`/`src/commands/mcp.js`'s post-bootstrap code | integration (subprocess, send SIGINT to child) | same file | ❌ Wave 0 |
| COST-01 | `cost --all` plain-text repeats per-session blocks + grand total; `--json` carries all sessions' turns | unit (compute() called directly, matching existing `cost.test.js` style) | `node --test src/commands/cost.test.js` | ❌ Wave 0 (extend existing file) |

### Sampling Rate
- **Per task commit:** targeted `node --test <file>` for the file(s) touched.
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus a manual one-time check with a real MCP client if available (not automatable in this sandbox).

### Wave 0 Gaps

- [ ] `src/commands/mcp.test.js` — new file. Pattern: use `child_process.spawn` (not `spawnSync` — the process must stay alive while the test interacts with it), matching the `BIN_PATH`/`makeTestRepo()` fixture conventions already established in `src/commands/compute-purity.test.js` and `src/helpers/test-repo.js`. Minimal JSON-RPC handshake to send over the child's stdin: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}\n`, assert a JSON-RPC response arrives on stdout with `result.serverInfo`, then send `{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n` (no response expected), then either close stdin (`child.stdin.end()`) and assert `child.on('exit', ...)` fires with code 0 and empty stderr beyond the D-01 line, or send `SIGINT` (`child.kill('SIGINT')`) and assert the same. Use a generous but bounded timeout (e.g. `setTimeout` + `child.kill('SIGKILL')` as a safety net) so a hung server can't hang the test suite indefinitely — no existing test in this repo does this, so this pattern is new and should be written carefully and reviewed.
- [ ] `src/commands/cost.test.js` — extend existing file with `--all` cases: two sessions in one fixture repo (via `startSession()`/`makeTurn()` from `src/helpers/turn-fixtures.js`, called twice to produce two distinct `session_id`s), assert plain-text output contains two `Session: <id>` blocks in turn order plus a grand-total line, and assert `--json --all` output's `turns` array contains entries from both sessions.
- [ ] Framework install: none — `node:test` is already in use project-wide, no new test framework needed.

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` (not found) — treated as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|---------------------|
| V2 Authentication | No | Local stdio subprocess, single-user, no network listener — no authentication surface exists for this transport |
| V3 Session Management | No | No HTTP session concept; the MCP "session" here is just "one subprocess's lifetime," already covered by MCP-03 |
| V4 Access Control | No | No multi-user/multi-tenant concept — the server has exactly the filesystem/git permissions of the user who launched it |
| V5 Input Validation | Not yet (Phase 9) | Phase 8 registers zero tools, so there is no tool-input surface to validate this phase. Phase 9 will need `zod` schemas per MCP-09's "never a thrown exception" requirement — flagged for that phase, not this one. |
| V6 Cryptography | No | Nothing in this phase touches secrets, tokens, or crypto — the pricing-fetch HTTPS call in `cost.js` is pre-existing, unchanged by COST-01 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Stdout pollution from a dependency corrupting the JSON-RPC stream (already covered extensively in milestone PITFALLS.md) | Tampering (of the protocol channel, not of data at rest) | `serveStdio()`'s documented contract reserves stdout exclusively for JSON-RPC; git-turn's own `console.error`-only discipline (already project convention) + the explicit official-docs confirmation that logging must use `console.error` |
| A `git turn mcp` process left running indefinitely after its launching client has already exited (orphaned subprocess) | Denial of Service (resource leak, not an attacker-facing threat given the local-only, single-user nature of this tool) | Handled by MCP-03's stdin-EOF auto-close — once the parent client process exits, its end of the stdio pipe closes, which the SDK detects and tears down automatically; no additional watchdog needed for this milestone's scope |

## Sources

### Primary (HIGH confidence)
- Direct `npm pack` + unpack + file inspection of `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/core@2.3.1`, `zod@4.6.5` (this session, 2026-10-21) — `package.json` exports map, `dist/stdio.cjs` export names (`serveStdio`, `StdioServerTransport`), `README.md`.
- `https://ts.sdk.modelcontextprotocol.io/v2/servers/tools` (official docs, fetched 2026-10-21) — `McpServer` construction, `registerTool` signature, CJS/ESM import forms.
- `https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio` (official docs, fetched 2026-10-21) — `serveStdio()` full example (CJS + ESM), SIGINT pattern, stdin-EOF auto-close behavior, keep-alive/`onclose` pattern.
- `https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2` (official docs, fetched 2026-10-21) — confirms manual `StdioServerTransport`/`connect()` pattern still present but superseded by `serveStdio()`.
- Direct source inspection of this repo (2026-10-21): `bin/git-turn`, `src/commands/cost.js`, `src/session.js`, `src/blame-util.js`, `src/commands/compute-purity.test.js`, `src/helpers/test-repo.js`, `package.json`.
- `npm view @modelcontextprotocol/server version dependencies peerDependencies`, `npm view zod version`, `npm view @modelcontextprotocol/server time.created time.modified`, `npm view @modelcontextprotocol/core time.created time.modified` (live registry queries, 2026-10-21).

### Secondary (MEDIUM confidence)
- None beyond the above — all findings in this document were either read directly from the installed package/official docs or derived from direct repo source inspection.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against actual unpacked package contents, not just registry metadata or training-data recall.
- Architecture: HIGH — the `serveStdio()` correction is a direct reading of official v2 docs, cross-checked against the actual package's exported symbols.
- Pitfalls: HIGH for the 4 new pitfalls identified (all code-verified against this repo); the milestone-level pitfalls (stdout pollution, process.exit, cwd drift, snapshot-sha bug class) remain valid and are not re-derived here, only cross-referenced.

**Research date:** 2026-10-21
**Valid until:** 2026-11-04 (14 days — this is a fast-moving dependency family; `@modelcontextprotocol/server` was last modified 2026-10-05, i.e. 16 days before this research, so re-verify version/API surface if planning/execution slips more than two weeks past this date)

---
*Phase 8 research: MCP server scaffold + cost --all fix*
*Researched: 2026-10-21*

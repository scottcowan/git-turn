# Project Research Summary

**Project:** git-turn — v0.4 milestone: MCP Server
**Domain:** Node.js CLI tool adding a long-running MCP (Model Context Protocol) stdio server addon that exposes 5 existing read-only CLI commands as tools
**Researched:** 2026-10-07
**Confidence:** HIGH

## Executive Summary

This milestone bolts a persistent, stdio-based MCP server onto git-turn — a CLI whose every existing command (`log`, `show`, `diff`, `blame`, `cost`, etc.) was built to run once, print to stdout, and `process.exit()`. That mismatch, not MCP protocol complexity, is the real engineering problem of this milestone. The stack question was initially resolved as "hand-roll, zero dependencies" but was explicitly superseded after discovering `@modelcontextprotocol/server@2.3.1` — a modular, narrowly-scoped package (only depends on `zod` + its own minimal `@modelcontextprotocol/core`) distinct from the heavy, 17-transitive-dependency legacy `@modelcontextprotocol/sdk@1.x`. The final decision is to take `@modelcontextprotocol/server` + `zod`, scoped only to the `.` and `./stdio` exports, as git-turn's first-ever runtime dependencies — a deliberate, narrow reversal of the project's longstanding zero-dependency posture, justified because hand-rolling JSON-RPC framing and the full MCP capability-negotiation handshake is a materially larger problem than the "vendored, not borrowed" precedent (`src/redact.js`, ~150 lines) was meant to cover.

The recommended approach is a `compute()`/`run()` split applied to `log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js` as a **hard prerequisite**, before any MCP tool is wired up. Every one of these modules currently calls `process.exit(1)` directly and writes via bare `console.log` on error and success paths alike — both of which are fatal to a long-running server: a single `process.exit(1)` kills the entire server (and every other in-flight tool call) over something as mundane as "turn 47 doesn't exist," and any stray `console.log` corrupts the JSON-RPC stdio stream for every subsequent message. The fix is one mechanical refactor applied once: each command exports a pure(ish) `compute(args)` that returns a string and throws `Error` instead of exiting, plus the existing `run(args)` as a thin CLI wrapper around it. The 5 target MCP tools (`git_turn_log`, `_show`, `_diff`, `_blame`, `_cost`) are then thin adapters that call the matching `compute()` in-process, return text-only `content` (no `outputSchema`/`structuredContent` needed — fully spec-compliant per MCP 2025-06-18), and convert thrown errors into `isError: true` results. Destructive/write commands (`revert`, `bisect`, `redact`, `record-prompt`) are explicitly out of scope this milestone — no MCP confirmation/elicitation pattern exists yet in this codebase, and the MCP spec itself recommends human-in-the-loop confirmation for sensitive tools, validating the deferral rather than just being a cautious choice.

The single biggest latent risk, flagged independently by both the architecture and pitfalls research, is reintroducing the snapshot-sha-vs-HEAD-sha notes lookup bug — a defect that has already shipped and been fixed twice in this project's history (v0.2 and v0.3). `listTurns()` returns a snapshot sha, not the HEAD commit sha where notes actually live; the already-fixed `parseSnapshotMessage(sha).headSha` pattern in `log.js`/`show.js`/`cost.js` must be reused verbatim by the new `compute()` functions, not re-derived, and the extraction work should end with a live round-trip test (real hook-written note -> MCP tool read), not hand-built fixtures alone — mirroring the exact methodology gap that let the bug ship silently twice before.

## Key Findings

### Recommended Stack

Final decision (superseding STACK.md's original "zero dependencies" verdict): `@modelcontextprotocol/server` (npm `2.3.1`, published 2026-04-01) + `zod` (`4.6.5`), git-turn's first-ever runtime dependencies. Both were live-verified via `npm view`/`npm pack` (dependency trees, `exports` maps, publish dates) by two independent researchers before the override was accepted.

**Core technologies:**
- `@modelcontextprotocol/server` (`.` and `./stdio` exports only) — provides `McpServer` + `StdioServerTransport`; depends only on `zod` + `@modelcontextprotocol/core` (itself zod-only) — no Express/Hono/cors/jose/ajv pulled in, unlike the legacy `@modelcontextprotocol/sdk` (`1.32.1`, 17 transitive deps, bundles unused HTTP/SSE/OAuth transport support)
- `zod` (`^4.2.0`, satisfied by `4.6.5`) — required because git-turn's own `src/mcp/tools/*.js` files author `z.object(...)` input schemas directly, not just a transitive need
- Ships dual CJS/ESM builds — `require()` works cleanly from git-turn's existing CommonJS codebase with zero build-step changes
- Explicitly rejected: `@modelcontextprotocol/sdk` (too heavy), `ajv`/`zod-to-json-schema` (unneeded — 5 tools with 1-2 primitive params), `express`/`hono` (stdio-only milestone, no HTTP transport needed), `cross-spawn` (Node 22 built-ins already sufficient)

### Expected Features

5 read-only, text-content-only tools mirroring exact CLI output, 1:1 named after their CLI commands so an agent already primed by AGENTS.md transfers its mental model directly.

**Must have (table stakes):**
- `git turn mcp` stdio subcommand — new `src/commands/mcp.js`, registered in `bin/git-turn`'s `COMMANDS` array
- `git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost` — one tool per existing read command, text-only `content`, no `outputSchema`
- Process-exit isolation solved once, applied to all 5 (the actual hard problem of this milestone, not the MCP wiring itself)
- Forced color-off for `show`/`diff` output in the MCP path (don't rely on `shouldColor()`'s TTY heuristic — an MCP client is never a TTY)
- Errors surfaced as `isError: true` tool results carrying the same message text the CLI prints today, never a thrown exception or `process.exit`
- Repo-scoping fixed to the server's launch-time cwd, matching every other `git turn` command's scoping model

**Should have (near-term fast-follows, not day-one):**
- Surfacing the already-captured `tool_summary` field via `git_turn_show` — zero new capture work, pure upside
- A CLI-wide `--json` flag (benefits scripts/CI too, not just MCP), as the right foundation for later `outputSchema`/`structuredContent` on `git_turn_log`/`git_turn_cost`

**Defer (explicitly out of scope this milestone):**
- `git_turn_revert`/`bisect`/`redact`/`record-prompt` as MCP tools — no MCP confirmation/elicitation pattern exists yet; deferred by decision, not capacity
- Pagination/filtering params beyond what the CLI itself supports — MCP surface must never get ahead of the CLI surface it mirrors
- Multi-repo/persistent server reuse across cwd changes — no existing state model supports this, no demonstrated need

### Architecture Approach

The core tension: every existing command module's `process.exit(1)`-on-error, `console.log`-as-you-go shape is correct for a one-shot CLI process and actively dangerous inside a long-running MCP server, where it would kill the whole server (and silently drop every in-flight/future tool call) over an ordinary bad argument. The fix is a `compute()`/`run()` split living inside the existing command files (not duplicated into new parallel files), applied once, before any tool is wired up. New code lives in a sibling `src/mcp/` directory (not nested under `src/commands/`, since MCP tools are a different protocol surface, not CLI verbs), with one adapter file per tool mirroring the existing one-file-per-command convention.

**Major components:**
1. `src/commands/{log,show,diff,blame,cost}.js` (modified) — each now exports `compute(args)` (pure-ish, returns string/throws `Error`) and `run(args)` (thin CLI wrapper, unchanged external behavior)
2. `src/commands/mcp.js` (new) — CLI entry for `git turn mcp`; builds the `McpServer`, connects `StdioServerTransport`, returns a long-lived promise that `bin/git-turn`'s existing promise-aware dispatch branch already handles unmodified (same branch written for `cost.js`'s async pricing fetch)
3. `src/mcp/server.js` (new) — factory that constructs `McpServer` and registers each tool
4. `src/mcp/tools/{log,show,diff,blame,cost}.js` (new, one per tool) — zod input schema + handler that calls the matching `compute()`, wraps success as `{content:[{type:'text',text}]}`, wraps thrown errors as `{content:[...], isError:true}`
5. `src/git.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js` — unchanged; both CLI and MCP paths share these, which is what guarantees the two surfaces can never silently drift apart

Build order matters here more than usual: Phase A (compute/run split) and Phase B (server scaffold, zero tools) have no data dependency on each other, but Phase C (registering the 5 tools) strictly requires both to be done first. One open MEDIUM-confidence item to verify empirically in Phase B: confirm `server.connect(transport)`'s promise genuinely doesn't resolve until stdio closes, rather than resolving right after the handshake (which would let Node exit despite stdin still being open).

### Critical Pitfalls

1. **stdout pollution from reused command modules / transitive dependencies** — the MCP stdio transport uses stdout exclusively for JSON-RPC frames; any `console.log` reachable from a tool handler (directly, or via a dependency's own stray stdout write) corrupts every subsequent message in the session, not just the triggering call. Avoid by banning `console.log` under any code path reachable from `src/mcp/`, auditing the full `require()` graph of extracted functions (including `node:sqlite`'s warning-suppression module-load behavior and `gitSafe` call sites that don't suppress stderr), and never attempting to fix this by monkeypatching `console.log` around existing `run()` calls (fragile, doesn't fix the `process.exit` risk below either).
2. **`process.exit()` reuse killing the long-running server** — every existing command module calls `process.exit(1)` liberally on error paths; a single bad tool call (bad turn number, uninitialized repo) would kill the entire server and every other in-flight tool call. Fix: the compute/run split must convert every `process.exit(1)` call site reachable from `compute()` into a `throw new Error(...)`; treat `grep -r process.exit src/mcp/` returning nothing as an explicit acceptance check before shipping.
3. **Reintroducing the snapshot-sha-vs-HEAD-sha notes lookup bug a third time** — already shipped and fixed twice (v0.2, v0.3); `listTurns()` returns a snapshot sha, not the HEAD sha where notes live. New `compute()` functions must reuse the already-fixed `parseSnapshotMessage(sha).headSha` pattern verbatim, never re-derive sha resolution from `listTurns()`'s raw output. This class of bug returns an *empty* result rather than an error, so unit tests against hand-built fixtures won't catch it — require a live round-trip test (real hook-written note -> MCP tool read) as an exit criterion.
4. **cwd/repo-scoping drift between server startup and per-call expectations** — a server's cwd is fixed at launch (nothing calls `chdir()`), unlike a one-shot CLI's fresh-cwd-per-invocation model. Decide and document explicitly: cwd is captured once at `git turn mcp` startup, validated as a git-turn-initialized repo at that point (failing loudly on stderr if not), and never re-read per call.
5. **Anti-pattern temptation: shelling out from the MCP server to the CLI and parsing stdout** — technically satisfies "mirror the CLI output" but pays full fork+exec + cold SQLite reopen cost per tool call, requires fragile re-parsing of already-formatted display text, and loses the in-process `Error` object in favor of re-interpreting an exit code. Call `compute()` in-process instead.

## Implications for Roadmap

Based on combined research, the natural phase structure follows the architecture researcher's build order almost exactly, since sequencing (not feature scope) is the dominant constraint of this milestone.

### Phase 1: Compute/Run Split (prerequisite refactor)
**Rationale:** Hard prerequisite for every later phase — pitfalls 1, 2, and 3 are all one piece of work ("make the five commands' logic exit-free and stdout-free, callable as library functions"), not independent fixes, and nothing MCP-shaped can be safely built before this lands.
**Delivers:** `compute(args)`/`run(args)` split in `src/commands/{log,show,diff,blame,cost}.js`, with `run()`'s CLI-visible behavior (stdout content, exit codes) byte-for-byte unchanged — existing tests should pass with zero test-file edits, which is itself the acceptance criterion.
**Avoids:** Pitfalls 1 (stdout pollution), 2 (dependency stdout/stderr writes), 3 (process.exit reuse) — and sets up the shared sha-resolution helper needed to avoid pitfall 5.

### Phase 2: MCP Server Scaffold (zero tools registered)
**Rationale:** The stdio transport lifecycle and dependency addition are independent of any individual tool's logic; isolating this phase lets the one MEDIUM-confidence open question (does `server.connect()`'s promise resolve only on stdio close, not right after handshake) get resolved empirically before any tool depends on it.
**Delivers:** `@modelcontextprotocol/server` + `zod` added to `package.json` (scoped to `.`/`./stdio` exports only), `src/mcp/server.js` (empty tool set), `src/commands/mcp.js`, `'mcp'` wired into `bin/git-turn`'s `COMMANDS` array and `--help` text. Manually smoke-tested: starts, stays alive on stdin, exits cleanly on stdin close/SIGINT.
**Uses:** Stack decision (`@modelcontextprotocol/server@2.3.1` + `zod@4.6.5`), Architecture Pattern 3 (stdio lifecycle inside the existing dispatcher's promise-aware `.catch` branch).

### Phase 3: Register the Five Read-Only Tools
**Rationale:** Strictly requires both Phase 1 (for `compute()` to call) and Phase 2 (for `registerTool` to exist) — cannot start earlier.
**Delivers:** `src/mcp/tools/{log,show,diff,blame,cost}.js`, each a thin adapter: zod input schema (per the per-tool argument shapes already derived from each command's existing argument parsing), calls the matching `compute()`, wraps success/error as MCP `content`/`isError`. Forced color-off for `show`/`diff`. `grep -r process.exit src/mcp/` returns nothing. Each tool has a test for both its success path and its thrown-`Error` -> `isError:true` path, including a live round-trip test against a real hook-written note (not a hand-built fixture) to catch pitfall 5's bug class specifically.
**Addresses:** All 5 table-stakes tools from FEATURES.md; the `tool_summary`-in-`show` differentiator is a natural one-line addition to fold in here since `show`'s adapter is already being written.
**Avoids:** Pitfall 5 (sha-resolution regression) via explicit reuse of `parseSnapshotMessage(sha).headSha`; pitfall 4 (cwd drift) via startup-time-only cwd capture, validated in Phase 2 but exercised here.

### Phase 4: End-to-End Verification with a Real MCP Client
**Rationale:** Unit/integration tests against hand-built fixtures are explicitly insufficient for this codebase's own documented bug history (the sha-resolution bug passed exactly this kind of testing twice) — a live client is the only way to validate the full round-trip.
**Delivers:** Claude Code (or another MCP client) pointed at `git turn mcp` via its CLI/`claude mcp add` mechanism; all 5 tools exercised against a real session with real turns; confirms an out-of-range turn number or uninitialized repo surfaces as a recoverable tool error (not a server crash); confirms a second, unrelated tool call still succeeds afterward in the same session.
**Addresses:** The "looks done but isn't" checklist from PITFALLS.md in full — data extraction correctness, error handling, prompt/note data correctness, cwd scoping correctness.

### Phase Ordering Rationale

- Phases 1 and 2 have no data dependency on each other and could in principle proceed in parallel, but Phase 3 strictly requires both — the roadmap should sequence them as prerequisites regardless, since combining them with Phase 3 risks skipping the acceptance checks each one has independently (byte-for-byte CLI output parity for Phase 1; clean stdio lifecycle for Phase 2).
- The destructive-tools question (`revert`/`bisect`/`redact`/`record-prompt`) is not a phase at all this milestone — it's explicitly deferred pending a future MCP confirmation/elicitation pattern that doesn't exist yet. Do not create a placeholder phase or extensibility hook for it.
- A CLI-wide `--json` flag and `outputSchema`/`structuredContent` support are real, valuable differentiators but are correctly scoped as a v0.4.x fast-follow, not part of this milestone's phase sequence — they depend on a design decision (CLI-wide flag vs. MCP-only parallel JSON layer) that doesn't need to block shipping the 5 text-only tools.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (MCP server scaffold):** The `server.connect()` promise-resolution-timing question is flagged MEDIUM confidence by the architecture researcher and needs empirical verification against the actual installed `@modelcontextprotocol/server@2.3.1` version, not assumed from docs. `/gsd-plan-phase --research-phase 2` is worth running if the implementing agent hits ambiguity in the SDK's actual stdio connect/lifecycle API during planning.

Phases with standard patterns (skip research-phase):
- **Phase 1 (compute/run split):** Mechanical refactor, fully scoped by direct code inspection already in ARCHITECTURE.md/PITFALLS.md — no external unknowns.
- **Phase 3 (register tools):** Pattern and per-tool schema shapes are already fully specified in FEATURES.md and ARCHITECTURE.md's Pattern 2 example.
- **Phase 4 (E2E verification):** Procedural, not a design problem — no research needed, just execution against a real client.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Final decision verified live via `npm view`/`npm pack` against the actual npm registry (dependency trees, `exports` maps, publish/modified dates) by two independent passes, not training-data recall. The original "zero deps" verdict was superseded only after this live verification surfaced a package the first pass had missed. |
| Features | HIGH on MCP protocol shape and git-turn's existing code (direct inspection + official 2025-06-18 spec fetch); MEDIUM on "typical CLI-wrapping MCP server conventions" (no live competitor survey of other git-adjacent MCP servers was performed) |
| Architecture | HIGH — all claims verified by reading this repo's source directly, plus live SDK inspection; one explicitly flagged MEDIUM-confidence item (stdio `connect()` promise resolution timing) carried into Phase 2's acceptance check rather than left unresolved |
| Pitfalls | HIGH on all code-verified claims (process.exit survey, console.log call sites, cwd resolution, the historical sha-resolution bug per RETROSPECTIVE.md); MEDIUM on the general MCP stdio stdout-exclusivity convention, which was not independently re-fetched against current `modelcontextprotocol.io` docs in that research pass (though it was independently confirmed in FEATURES.md's and STACK.md's live spec fetches, so the overall project-level confidence on this point is effectively HIGH) |

**Overall confidence:** HIGH

### Gaps to Address

- **`server.connect(transport)` promise-resolution timing** (MEDIUM confidence, ARCHITECTURE.md Pattern 3): must be verified empirically in Phase 2 with a manual stdio smoke test before any tool logic is built on top of it. If it resolves early, `bin/git-turn`'s dispatch would reach end-of-file and Node would exit despite stdin remaining open — flag this as a go/no-go check at the end of Phase 2, not an assumption carried forward.
- **CLI-wide `--json` flag timing**: FEATURES.md recommends this as the right foundation for `outputSchema`/`structuredContent` differentiators, but it's explicitly a v0.4.x fast-follow decision, not resolved here. The roadmap should note it as a candidate for a follow-up milestone rather than silently dropping it.
- **MCP stdout-exclusivity convention**: PITFALLS.md flagged this as not independently re-fetched in that specific research pass; STACK.md and FEATURES.md did independently fetch and confirm the current 2025-06-18 spec's stdio transport framing rules, so this gap is effectively closed at the project level — no further action needed, but worth a final spec re-check against whatever SDK minor version is actually pinned at implementation time.

## Sources

### Primary (HIGH confidence)
- `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`, `/basic/lifecycle`, `/server/tools` — official MCP spec, fetched 2026-10-07 (STACK.md, FEATURES.md)
- `npm view @modelcontextprotocol/sdk@1.32.1 dependencies`, `npm view @modelcontextprotocol/server/@modelcontextprotocol/core version dependencies time.created time.modified`, `npm pack @modelcontextprotocol/server`/`npm pack zod` + `exports` map inspection — live npm registry queries, 2026-10-07 (STACK.md, ARCHITECTURE.md)
- `npx ctx7@latest docs /modelcontextprotocol/typescript-sdk` (Context7) — `McpServer`/`registerTool`/`StdioServerTransport` API shape, fetched 2026-10-07 (ARCHITECTURE.md)
- Direct source inspection: `bin/git-turn`, `src/commands/{log,show,diff,blame,cost,init,export,...}.js`, `src/git.js`, `src/cache.js`, `src/session.js`, `.planning/PROJECT.md`, `.planning/RETROSPECTIVE.md`, `AGENTS.md` — all four research files, 2026-10-07

### Secondary (MEDIUM confidence)
- General MCP stdio stdout-exclusivity convention as recalled in PITFALLS.md's own research pass (not independently re-fetched there, though corroborated by the primary spec fetches in STACK.md/FEATURES.md)
- "Typical CLI-wrapping MCP server" naming/structuring conventions (FEATURES.md) — reasoned from spec + git-turn's own constraints, no live competitor survey performed

---
*Research completed: 2026-10-07*
*Ready for roadmap: yes*

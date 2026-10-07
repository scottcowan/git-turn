# Architecture Research

**Domain:** Node.js CLI tool adding a long-running MCP (Model Context Protocol) server addon to a short-lived, run-once-and-exit command dispatcher
**Researched:** 2026-10-07
**Confidence:** HIGH (all claims verified by reading this repo's source directly, plus live `npm view`/`npm pack` inspection of the current MCP TypeScript SDK; the only MEDIUM-confidence item is noted inline)

## Standard Architecture

### The core tension

Every existing `git turn <cmd>` module (`src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`, etc.) follows the same shape: parse `args`, call `process.exit(1)` directly on any error path, `console.log` formatted output inline as it's computed, return `undefined` (or a `Promise` for `cost.js`'s async pricing fetch). `bin/git-turn` dispatches by `require`-ing the module and calling `.run(args)`, awaiting the result only to attach a `.catch` that itself calls `process.exit(1)`.

That shape is fine for a process that runs once and exits — `process.exit(1)` just ends the one invocation. It is **actively dangerous** inside `git turn mcp`: the MCP server is one Node process handling an open-ended stream of tool calls over its lifetime, and a stray `process.exit(1)` reachable from a tool handler would kill the entire server (and silently drop every other in-flight or future tool call) over something as mundane as "turn 47 doesn't exist" or "repo not initialized." This is the single architectural fact that should drive every decision below.

### System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                         bin/git-turn (CLI entry)                   │
├───────────────────────────────────────────────────────────────────┤
│  COMMANDS = [..., 'mcp']  →  src/commands/mcp.js                   │
│  (every other entry unchanged: require(cmdPath).run(args))         │
├───────────────────────────┬───────────────────────────────────────┤
│   One-shot commands        │   Long-running MCP server             │
│   (existing, run-and-exit) │   (new, stays alive on stdio)         │
│  ┌──────────────────────┐  │  ┌──────────────────────────────────┐ │
│  │ src/commands/log.js   │  │  │ src/commands/mcp.js              │ │
│  │   run(args)  — CLI,   │  │  │   run(args) — builds McpServer,  │ │
│  │   console.log+exit    │  │  │   connects StdioServerTransport, │ │
│  │   compute(args) — pure│◄─┼──┤   never calls process.exit       │ │
│  │   data/string, throws │  │  └───────────────┬──────────────────┘ │
│  └──────────────────────┘  │                  │                    │
│  (same split applied to    │  ┌───────────────▼──────────────────┐ │
│   show/diff/blame/cost)    │  │ src/mcp/tools/*.js (new)          │ │
│                             │  │   one file per tool, registers   │ │
│                             │  │   via server.registerTool(),     │ │
│                             │  │   zod input schema, calls the    │ │
│                             │  │   matching compute() above,      │ │
│                             │  │   catches throws → isError:true  │ │
│                             │  └───────────────┬──────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│         src/git.js (execFile wrapper) · src/cache.js (SQLite)       │
│         src/session.js · src/blame-util.js  — UNCHANGED, both       │
│         call paths (CLI run() and MCP compute()) share these        │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| `bin/git-turn` | Dispatch table (`COMMANDS` array + `require`) | One new entry (`'mcp'`), zero structural change to the dispatch mechanism itself |
| `src/commands/<cmd>.js` (refactored) | Exports **two** functions: `compute(args)` (pure-ish: resolves session/turns, returns a string or throws `Error`) and `run(args)` (CLI shell: calls `compute`, `console.log`s the result, catches thrown errors into `console.error` + `process.exit(1)`) | This is the one prerequisite refactor every tool handler depends on — see Build Order |
| `src/commands/mcp.js` (new) | CLI entry point for `git turn mcp`; builds the `McpServer`, registers tools, connects `StdioServerTransport`, returns a `Promise` that only resolves on clean stdio close | Mirrors the existing async-command contract (`cost.js` already returns a `Promise` that `bin/git-turn` already knows how to await/catch) — no change needed to the dispatcher's promise-handling branch |
| `src/mcp/server.js` (new, optional split) | Factory that constructs the `McpServer` instance and calls `registerTool` for each tool module | Keeps `mcp.js` itself thin; useful if `mcp.js` later needs argv parsing (e.g. a future `--http` transport) separate from server construction |
| `src/mcp/tools/<name>.js` (new, one per tool) | Zod input schema + handler that calls the matching `compute()`, wraps the string result as `{ content: [{ type: 'text', text }] }`, and on a thrown `Error` returns `{ content: [...], isError: true }` instead of letting the exception escape | Each file is small and independently testable without starting a real stdio transport (handlers are plain async functions) |
| `src/git.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js` | Unchanged | Both the CLI path and the MCP path call into the exact same helpers — this is what guarantees `git turn log` and `git_turn_log` can never silently drift apart in behavior |

## Recommended Project Structure

```
src/
├── commands/
│   ├── log.js          # MODIFIED: split run() → run()+compute()
│   ├── show.js         # MODIFIED: same split
│   ├── diff.js         # MODIFIED: same split
│   ├── blame.js        # MODIFIED: same split
│   ├── cost.js         # MODIFIED: same split (compute() stays async)
│   └── mcp.js          # NEW: `git turn mcp` CLI entry
├── mcp/
│   ├── server.js        # NEW: McpServer factory + tool registration
│   └── tools/
│       ├── log.js       # NEW: git_turn_log tool adapter
│       ├── show.js       # NEW: git_turn_show tool adapter
│       ├── diff.js       # NEW: git_turn_diff tool adapter
│       ├── blame.js     # NEW: git_turn_blame tool adapter
│       └── cost.js       # NEW: git_turn_cost tool adapter
├── git.js               # unchanged
├── cache.js             # unchanged
├── session.js           # unchanged
└── blame-util.js        # unchanged
```

### Structure Rationale

- **`src/mcp/` as its own top-level directory, not nested under `src/commands/`:** `src/commands/*.js` is a dispatch table keyed 1:1 to `bin/git-turn`'s `COMMANDS` array — each file there is a CLI verb. The MCP tools are not CLI verbs; they're a different protocol surface reusing the same compute logic. Keeping them in a sibling directory makes the reuse direction explicit (`src/mcp/tools/*` depends on `src/commands/*`, never the reverse) and avoids `bin/git-turn`'s `COMMANDS.includes(cmd)` guard ever accidentally matching a tool-adapter filename.
- **One adapter file per tool under `src/mcp/tools/`,** not one monolithic tool-registration file: mirrors the existing one-file-per-command convention in `src/commands/`, keeps each tool's zod schema next to its handler, and means adding a 6th tool later (e.g. `git_turn_heatmap`, if a future milestone un-defers it) is "add one file + one `registerTool` call," not an edit to a growing switch statement.
- **`compute()`/`run()` split lives inside the existing command files,** not in new parallel files: the alternative (duplicate the logic into `src/mcp/`) would require every future bugfix to be made twice and would already have drifted by the time `blame.js`'s untracked-file fallback path is touched again. Splitting in place is a few lines of diff per file (see Build Order) and keeps one source of truth.

## Architectural Patterns

### Pattern 1: compute/run split (the prerequisite refactor)

**What:** Extract each command's existing logic into a `compute(args)` function that returns the final string (or, for async `cost.js`, a `Promise<string>`) and **throws** `Error` instead of calling `console.error` + `process.exit(1)`. The existing `run(args)` becomes a thin wrapper: call `compute`, `console.log` the result, and on a caught `Error`, do exactly what it does today (`console.error`, `process.exit(1)`).

**When to use:** Before any MCP tool is wired up — this is a hard prerequisite, not a nice-to-have, because of the `process.exit` hazard above.

**Trade-offs:** Low risk, mechanical refactor — the formatted-text-building logic in `log.js`/`show.js`/`diff.js`/`blame.js`/`cost.js` is already structured as "build a string, print it," so most of the diff is replacing `console.log(x)` with `lines.push(x)` (or template-literal concatenation) and `return lines.join('\n')` at the end, plus `process.exit(1)` → `throw new Error(...)`. The CLI-visible behavior (stdout content, exit codes) should be byte-for-byte identical before and after — this refactor has no reason to change what `git turn log` prints, only how the module exposes that computation internally. Existing tests for each command should pass unmodified if this invariant holds; that invariant is itself the acceptance criterion for the refactor.

**Example (shape, not literal diff):**
```js
// src/commands/log.js — after refactor
function compute(args) {
  const session = readSession();
  if (!session) throw new Error('git turn: not initialized. Run `git turn init` first.');
  // ...identical logic as today, but push to an array instead of console.log...
  return lines.join('\n');
}

function run(args) {
  try {
    console.log(compute(args));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
```

### Pattern 2: MCP tool adapter = thin wrapper around `compute()`

**What:** Each `src/mcp/tools/<name>.js` registers a tool whose handler calls the matching `compute()`, returns its string as MCP `content`, and converts a thrown `Error` into `{ content: [...], isError: true }` (the SDK's documented recoverable-failure shape) rather than letting it propagate and crash the server process.

**When to use:** For every read-only tool in this milestone's scope (`git_turn_log`, `_show`, `_diff`, `_blame`, `_cost`).

**Trade-offs:** Returning the exact same formatted text the CLI prints (not a re-parsed structured object) is the pragmatic choice here: `log`/`show`/`diff`/`blame` output is inherently diff/table text with no existing structured representation, and building a parallel JSON schema for "a git diff" would be new scope with no current consumer. The milestone's own framing — "mirroring the existing CLI commands' output" — confirms text-mirroring is the intended contract, not a structured API. The cost of this choice: if a future milestone wants MCP clients to do their own structured reasoning over turn data (e.g. "which turns touched this file" as a list, not formatted text), that's a new, separate tool design question, not a retrofit of these five adapters.

**Example:**
```js
// src/mcp/tools/log.js
const { z } = require('zod');
const { compute } = require('../../commands/log');

function register(server) {
  server.registerTool(
    'git_turn_log',
    {
      description: "List turns in the current session (mirrors `git turn log`)",
      inputSchema: z.object({
        withPrompts: z.boolean().optional().describe('Include first line of captured prompt per turn'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    async ({ withPrompts, noCache }) => {
      const args = [withPrompts && '--with-prompts', noCache && '--no-cache'].filter(Boolean);
      try {
        return { content: [{ type: 'text', text: compute(args) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );
}

module.exports = { register };
```

### Pattern 3: stdio server lifecycle inside the existing dispatcher

**What:** `src/commands/mcp.js`'s `run(args)` builds the server, calls `await server.connect(transport)`, and returns the resulting (long-lived) promise. `bin/git-turn` already has a branch for this: `if (result && typeof result.then === 'function') result.catch(err => {...; process.exit(1)})` — written originally for `cost.js`'s pricing fetch, it works unmodified for a server connection that only settles on transport close/error.

**When to use:** This is the only way `git turn mcp` fits into the existing one-`require`-one-`run()` dispatch model without touching `bin/git-turn`'s dispatch mechanism at all — only its `COMMANDS` array and `--help` text need a new line.

**Trade-offs:** None significant — the existing promise-aware dispatch branch was already general enough. The one thing to verify explicitly during implementation: confirm `server.connect(transport)`'s promise genuinely doesn't resolve until the stdio stream closes (per the SDK's `serveStdio`/`connect` contract) rather than resolving immediately after the handshake — otherwise `bin/git-turn`'s script would reach end-of-file and Node would exit despite stdin still being open. (MEDIUM confidence on this specific resolution timing — verify empirically in Phase B below with a manual stdio smoke test before building tools on top of it.)

## Data Flow

### Request Flow (one MCP tool call)

```
MCP client (e.g. Claude Code)
    │  JSON-RPC tool-call over stdio
    ▼
McpServer (src/mcp/server.js) — routes by tool name
    │
    ▼
src/mcp/tools/log.js handler — validates args via zod, builds CLI-style argv array
    │
    ▼
src/commands/log.js compute(args) — readSession() [fs read] → cache.getTurns() [SQLite query,
    │                                 reusing the already-open process-lifetime DB handle]
    │                                 → falls back to listTurns()+git plumbing if cache empty
    ▼
returns formatted string, or throws Error
    │
    ▼
tool handler wraps as { content: [...] } or { content: [...], isError: true }
    │  JSON-RPC tool-result over stdio
    ▼
MCP client renders content to the model
```

### Why the long-running process changes nothing about cache correctness

`src/cache.js` already has a module-level `_db` singleton (`let _db = null`, populated by `openDb()` and never closed until explicit `closeDb()`). Every existing CLI invocation opens a *fresh* process, so in practice `_db` has only ever lived for the duration of one command. Inside `git turn mcp`, `_db` instead lives for the server's entire session — this is a **benefit**, not a hazard: it avoids repeatedly reopening the SQLite file per tool call. It introduces no staleness risk because every query (`getTurns`, `getAllTurns`, `getTurnsForFile`) issues a fresh `SELECT` against the open handle on each call, and SQLite's own file-level transaction semantics mean a `SELECT` sees whatever the last committed writer (e.g. the post-commit hook, firing in a separate `git commit` process while the agent keeps working during the same live MCP session) wrote — no manual invalidation or reconnect logic is needed. This is the same cache-first guarantee every CLI command already relies on; the MCP server just gets to amortize the `openDb()` cost across many calls instead of paying it once per call.

### `--no-cache` fallback pattern, reused verbatim

Nothing about `--no-cache` is cache-specific to the CLI — it's a parameter on `compute(args)` exactly as it is on `run(args)` today (`args.includes('--no-cache')`). The MCP tool adapters expose it as an optional `noCache: z.boolean().optional()` input and translate it into the same `'--no-cache'` string the CLI parser already understands (see Pattern 2's example) rather than inventing a second parsing path. This is the one piece of real design leverage from the compute/run split: the *same* argv-shaped array that `bin/git-turn` constructs from `process.argv` is exactly what an MCP tool handler constructs from its validated zod input — one parsing contract, two callers.

### Repo scoping — fixed for the server's whole lifetime, by construction

Every `src/git.js` helper defaults `cwd` to `process.cwd()`. For one-shot CLI commands this means "whichever directory you ran `git turn` from"; for `git turn mcp` it means "whichever directory the MCP client spawned the `git turn mcp` subprocess from," fixed for as long as that subprocess lives (Node's `process.cwd()` never changes without an explicit, never-called `process.chdir()`). This requires no new code — it falls out of reusing `src/git.js` unchanged — but is worth stating explicitly in the tool/server documentation: an MCP client wanting multi-repo coverage spawns one `git turn mcp` process per repo (the normal pattern for stdio MCP servers, one process per client-configured server entry), not one process asked to switch repos mid-session.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single repo, one MCP client session (the only case this milestone targets) | Current design handles this directly — no changes needed beyond what's described above |
| Multiple concurrent tool calls in flight on one server | The MCP SDK dispatches each tool call as its own async handler invocation; `src/git.js`'s `execFileSync` calls are synchronous and block the event loop for their duration (true today for the CLI too — a `git diff` on a huge turn already blocks that one process). Not a new risk introduced by this milestone, but worth flagging if a *future* milestone adds a tool whose `compute()` does something slow and concurrent calls pile up — not a concern for `log`/`show`/`diff`/`blame`/`cost`, which are each one or a handful of fast git subprocess calls |
| A future write/destructive tool (explicitly out of scope this milestone: `revert`, `bisect`, `redact`, `record-prompt`) | Deferred by the milestone itself specifically because no confirmation/dry-run pattern exists yet for MCP tool calls — correctly scoped out, not an oversight; don't retrofit it into this phase |

## Anti-Patterns

### Anti-Pattern 1: Shelling out from the MCP server to the CLI and parsing stdout

**What people do:** Have each `src/mcp/tools/*.js` handler `execFileSync('git', ['turn', 'log', ...])` (or spawn `bin/git-turn` directly) and parse the captured stdout back into whatever shape the tool wants to return.

**Why it's wrong:** This milestone's own target feature list says the tools should "mirror the existing CLI commands' output" — shelling out would technically satisfy that by construction, so it's tempting. But it: (1) pays a full `fork+exec` cost (plus a second cold SQLite `openDb()`) on every single tool call, discarding exactly the long-running-process benefit a server exists to provide; (2) requires re-parsing already-formatted display text (padded columns, truncated-to-50-chars subject lines) back out, which is strictly more fragile than calling the function that produced that text in the first place — any future formatting tweak (e.g. widening a column) now has to stay parseable by a regex nobody will remember exists; (3) loses the in-process error signal — a non-zero exit code from a child process has to be re-interpreted into an `isError` MCP result, when the parent process already has the real `Error` object available for free if it calls the function directly instead of shelling out to its own CLI wrapper around that function.

**Do this instead:** `require()` the sibling `src/commands/<name>.js` module and call its `compute()` function in-process (Pattern 2 above). Same codebase, same process, zero subprocess overhead, and the "mirrors CLI output" requirement is satisfied exactly because both paths call the identical function.

### Anti-Pattern 2: Leaving `process.exit()` reachable from any code path a tool handler can trigger

**What people do:** Register tools against the *existing* `run(args)` functions without first doing the compute/run split, reasoning "it already does the right thing for the CLI, why touch it."

**Why it's wrong:** Every existing command's error path is `console.error(...); process.exit(1)`. If a tool handler calls `run()` directly, the very first "turn 999 not found" or "not initialized" error a user hits via an MCP client kills the whole server process — including every other tool call that might be in flight, and silently, from the client's point of view (the stdio pipe just dies). This is not a hypothetical: `show.js`, `diff.js`, and `log.js` all hit this path on ordinary, expected user input (an out-of-range turn number), not just on bugs.

**Do this instead:** The compute/run split (Pattern 1) is the fix, and it's a correctness prerequisite, not a style preference — build it first, and treat "no `process.exit` call is reachable from anything under `src/mcp/`" as an explicit acceptance check (e.g. a quick `grep -r process.exit src/mcp/` returning nothing) before shipping the server.

## Integration Points

### External Services / Dependencies

| Service / Package | Integration Pattern | Notes |
|---------|---------------------|-------|
| `@modelcontextprotocol/server` (new runtime dependency — **git-turn's first ever**, per-`npm view` 2026-10-07) | `require('@modelcontextprotocol/server')` for `McpServer`, `require('@modelcontextprotocol/server/stdio')` for `StdioServerTransport` | Ships both CJS (`.cjs`) and ESM (`.mjs`) builds (`"exports"` map verified via `npm pack` on `2.3.1`), so it `require()`s cleanly from this CommonJS codebase with no build-step or `"type": "module"` change needed anywhere in git-turn. Its own dependency footprint is minimal: only `zod` and `@modelcontextprotocol/core` (which itself depends only on `zod`) — no `express`/`hono`/`cors` pulled in, because those live in the separate, heavier legacy `@modelcontextprotocol/sdk` (v1.x) package, which bundles every transport (HTTP, SSE, stdio) and is **not** what this milestone needs (stdio only) |
| `zod` (new, direct dependency — required because tool input schemas are authored in git-turn's own code, not just transitively needed by the SDK) | `require('zod')` (root export is Zod v4 as of `4.6.5`) | Must satisfy the SDK's peer requirement (`^4.2.0` for `@modelcontextprotocol/server@2.3.1`/`core@2.3.1`) — pin `zod` explicitly in `package.json` rather than relying on it resolving only as a transitive dependency, since git-turn code calls `z.object(...)` directly in every `src/mcp/tools/*.js` file |

**This reverses, deliberately and narrowly, the project's longstanding zero-new-npm-dependency posture** (previously upheld even for the secret-redaction scanner, which was hand-vendored rather than importing `secretlint`/`gitleaks-node`). That precedent was about a *small, self-contained, easily-hand-written* feature (regex + Shannon entropy, ~150 lines). Hand-rolling a JSON-RPC 2.0 framed stdio transport plus the full MCP capability-negotiation handshake is a different order of scope entirely — doing that by hand would be the actual architectural mistake here, not taking the dependency. Scope the dependency narrowly: only `@modelcontextprotocol/server` + its `/stdio` subpath export, not the heavier `@modelcontextprotocol/sdk` package, and only `zod`, not `zod-to-json-schema`/`ajv`/etc. (those live inside the SDK's own dependency tree already, where needed).

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `src/mcp/tools/*.js` ↔ `src/commands/*.js` | Direct `require()` + function call (`compute(args)`) | One-directional dependency; `src/commands/*` must never `require('../mcp/...')` |
| `src/commands/mcp.js` ↔ `src/mcp/server.js` | Direct `require()` — `mcp.js` is the CLI-facing shell, `server.js` is the reusable factory | Matches the existing convention where `src/commands/*.js` is a thin CLI shell around logic that could in principle be called from elsewhere (here, "elsewhere" is realized for the first time) |
| `bin/git-turn` ↔ `src/commands/mcp.js` | Unmodified dispatch mechanism (`require(cmdPath).run(args)`, promise-aware `.catch`) | Zero changes to `bin/git-turn` beyond adding `'mcp'` to `COMMANDS` and a `--help` line |

## Build Order

This is the one place where sequencing matters more than usual: **the compute/run refactor is a hard prerequisite for every tool handler**, not independent parallel work.

1. **Phase A — Refactor existing commands to separate `compute()` from `run()`.** Touches `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`. No new files, no new dependencies. Acceptance check: existing CLI behavior (stdout, exit codes) is byte-for-byte unchanged — run the existing test suite and confirm it passes with zero test-file edits.
2. **Phase B — MCP server scaffold with zero tools registered.** Add `@modelcontextprotocol/server` + `zod` to `package.json`, add `src/mcp/server.js` (empty `registerTool` set) and `src/commands/mcp.js`, wire `'mcp'` into `bin/git-turn`'s `COMMANDS` array and `--help` text. Acceptance check: manually smoke-test that `git turn mcp` starts, stays alive on stdin, and exits cleanly on stdin close/SIGINT — this also resolves the one MEDIUM-confidence open question (Pattern 3) about `server.connect()`'s promise-resolution timing, before any tool logic depends on it.
3. **Phase C — Register the five read-only tools.** Add `src/mcp/tools/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`, each calling its Phase-A `compute()`. Acceptance check: `grep -r process.exit src/mcp/` returns nothing (Anti-Pattern 2's explicit check); each tool handler has a test exercising both its success path and its thrown-`Error` → `isError: true` path.
4. **Phase D — End-to-end verification with a real MCP client.** Point Claude Code (or another MCP client) at `git turn mcp` via its CLI/`claude mcp add` mechanism, exercise all five tools against a real session with real turns, confirm an out-of-range turn number or an uninitialized repo surfaces as a recoverable tool error rather than killing the server, and confirm a second, unrelated tool call still succeeds afterward in the same session.

Phases A and B have no data dependency on each other and could in principle be built in parallel by different people, but Phase C strictly requires both A (for `compute()` to call) and B (for `registerTool` to exist) to be done first.

## Sources

- Direct source inspection of this repo (2026-10-07): `bin/git-turn`, `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`, `src/git.js`, `src/cache.js`, `src/session.js`, `.planning/PROJECT.md`. HIGH confidence — all dispatch, error-handling, and cache-singleton claims verified by reading the actual code, not assumed.
- `npx ctx7@latest docs /modelcontextprotocol/typescript-sdk` (Context7, fetched 2026-10-07) — `McpServer`/`registerTool`/`StdioServerTransport`/`serveStdio` API shape, including the `isError: true` recoverable-failure pattern. HIGH confidence (current official SDK docs, not training data).
- `npm view @modelcontextprotocol/sdk version dependencies`, `npm view @modelcontextprotocol/server version dependencies`, `npm view @modelcontextprotocol/core version dependencies`, `npm view @modelcontextprotocol/server time.created time.modified` (live npm registry queries, 2026-10-07) — confirmed the lighter, actively-maintained (`2.3.1`, last published 2026-10-05) `@modelcontextprotocol/server`+`core` package pair as the correct choice over the heavier, older (`1.32.1`, created 2024-11-11) `@modelcontextprotocol/sdk`, which bundles unused HTTP-transport dependencies (`express`, `hono`, `cors`, `jose`). HIGH confidence (live registry data, not training-data assumption about package naming).
- `npm pack @modelcontextprotocol/server` + inspecting the unpacked `package.json`'s `"exports"` map (2026-10-07) — confirmed dual CJS/ESM build (`require()` works from this CommonJS codebase with no build step). HIGH confidence (inspected the actual shipped package, not documentation claims about it).
- `npm pack zod` + inspecting its `"exports"` map (2026-10-07) — confirmed `zod@4.6.5`'s root export is Zod v4, satisfying the SDK's `^4.2.0` peer requirement directly via `require('zod')`. HIGH confidence.

---
*Architecture research for: MCP server addon integration, git-turn v0.4*
*Researched: 2026-10-07*

# Phase 9: Register Read-Only MCP Tools - Research

**Researched:** 2026-11-01
**Domain:** MCP tool registration on an already-scaffolded `@modelcontextprotocol/server` stdio server, wrapping five existing `compute(args, opts)` CLI functions
**Confidence:** HIGH (every claim below verified by reading this repo's actual source and the actually-installed `node_modules/@modelcontextprotocol/server` type declarations — no training-data guesses about the SDK's current API shape)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Tool description verbosity
- **D-01:** Each tool's `description` field is a concise one-liner naming every parameter — e.g. `"List turns in the current session (mirrors \`git turn log\`). Supports withPrompts/noCache."` — short enough for fast LLM-client reading, but complete enough that the client doesn't have to guess at available parameters.

### Color forcing for git_turn_show/git_turn_diff (MCP-10)
- **D-02:** Tool handlers for `git_turn_show`/`git_turn_diff` pass an explicit color-off override that bypasses `shouldColor()`'s `FORCE_COLOR`/`isTTY` check entirely, rather than relying on stdout-never-being-a-TTY as sufficient. This guards against the MCP server process inheriting `FORCE_COLOR=1` from its launching shell and leaking ANSI codes into tool output. Implementation detail (exact param name/shape on `compute()`) is planner's call, but the behavior must be unconditional, not environment-dependent.

### MCP parameter naming
- **D-03:** All 5 tools' zod input schemas use camelCase parameter names matching the milestone ARCHITECTURE.md's own Pattern 2 example: `withPrompts`, `noCache`, `turn`, `toTurn` (for `git_turn_diff`'s optional second turn number), `all` (for `git_turn_cost --all`). Not snake_case, not a literal mirror of the CLI's kebab-case flag spelling.

### compute() calling convention
- **D-04:** Tool handlers reconstruct a CLI-flag-shaped argv array (e.g. `[withPrompts && '--with-prompts', noCache && '--no-cache'].filter(Boolean)`) and call the existing `compute(args)` functions unchanged — per the milestone ARCHITECTURE.md's explicit rationale ("one parsing contract, two callers"). No new options-object parameter is added to any of the 5 command files. The only signature change permitted is D-02's color-off override.

### Claude's Discretion
- Exact field/param ordering within each tool's zod schema beyond the names locked in D-03.
- Whether `src/mcp/tools/*.js` is one file per tool (matching the milestone ARCHITECTURE.md's recommended structure) — already effectively locked by that research, not re-litigated here.
- Exact wording of each tool's one-line description beyond D-01's "name every parameter" constraint.

### Deferred Ideas (OUT OF SCOPE)

None new from this discussion. Reviewed-but-not-folded todos: `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` (stale, already shipped as COST-01), `2026-11-01-git-turn-install-global-hook-via-init-templatedir.md` (unrelated new CLI feature), `2026-09-17-mindwalk-integration.md` (open-ended research), `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` (open-ended research), `2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md` (write-direction counterpart to this MCP server, unrelated to read-only tool registration).
</user_constraints>

## Summary

Phase 8 shipped a zero-tool `McpServer` (`src/mcp/server.js`'s `createServer()`) and a working stdio lifecycle (`src/commands/mcp.js`). Phase 7 already split every target command (`log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`) into `compute(args, opts = {})` (throws `Error`, never calls `process.exit`/`console.log`) and a thin CLI `run(args)` wrapper. This phase's job is almost entirely glue: one `src/mcp/tools/<name>.js` file per tool, each registering a zod-schema'd tool whose handler reconstructs a CLI-flag argv array, calls the matching `compute()`, and wraps the result as `{ content: [{ type: 'text', text }] }` or `{ content: [...], isError: true }`.

Three things are **not** pure glue and need explicit planner attention: (1) `show.js`'s plain-text output currently never prints `tool_summary` — success criterion 2 requires the MCP tool to include it, which means `show.js`'s text-building logic itself needs a one-line addition, not just the MCP adapter; (2) `shouldColor()` has no override parameter today — `diff.js`/`show.js` call it directly in two places each (rich-render branch and `--plain` branch), and D-02 requires an unconditional color-off override reachable from the MCP path, which means threading an `opts.color` (or similarly named) field through `compute()` into both call sites; (3) VERIFY-03's live round-trip test needs a real hook-written note (via `addNote`/`makeTurn` fixture helpers, the same pattern `show.test.js`'s existing `VERIFY-01` tests already use) read back through each tool's handler directly, not through a live stdio subprocess (that's Phase 10's job per `mcp.test.js`'s existing subprocess pattern).

**Primary recommendation:** Build one `src/mcp/tools/<name>.js` file per tool following the exact Pattern-2 shape already in `ARCHITECTURE.md` for `log.js`; add a minimal `opts.color` passthrough to `diff.js`/`show.js`'s `compute()` (default: fall back to `shouldColor()` so CLI behavior is unchanged); add a `tool_summary` line to `show.js`'s plain-text output; export each tool's handler function directly (not just via `register(server)`) so tests can call it without a stdio transport.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool registration (`registerTool` calls, zod schemas) | MCP server process (`src/mcp/server.js`, `src/mcp/tools/*.js`) | — | This IS the server's protocol surface; no other tier owns it |
| Argv reconstruction (camelCase params -> CLI-flag-shaped array) | MCP tool adapter (`src/mcp/tools/*.js`) | — | D-04 locks this as the adapter's sole responsibility; `compute()` must not learn a second parsing contract |
| Business logic / data resolution (sha lookup, notes read, diff computation, pricing fetch) | Command layer (`src/commands/*.js`'s `compute()`) | — | Unchanged by this phase except the two surgical additions below; this is the single source of truth both CLI and MCP call into |
| Color decision | Command layer (`compute()`'s internal `shouldColor()`/override check) | MCP tool adapter (passes the override flag) | The decision logic (env vars, TTY, override) stays inside `compute()`; the adapter's only job is to supply the override value, not reimplement the decision |
| Error-to-protocol translation (`Error` -> `isError: true`) | MCP tool adapter | — | `compute()` throws plain `Error`; converting that into the MCP wire shape is adapter-only, mirroring Pattern 2 exactly |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@modelcontextprotocol/server` | `2.3.1` (already pinned in `package.json`, verified installed) | `McpServer.registerTool()` | Already the project's chosen MCP runtime (Phase 8); no alternative considered this phase |
| `zod` | `4.6.5` (already pinned, verified installed) | Tool input schemas | SDK's peer dependency; `z.object({...})` is the documented `inputSchema` shape for `registerTool` |

No new packages are installed this phase — both dependencies were added and legitimacy-checked in Phase 8 (08-02-SUMMARY.md: human-verified `npm view` legitimacy check, exact-pinned). **No Package Legitimacy Audit section is needed** — this phase installs nothing new.

### Alternatives Considered
Not applicable — the SDK, schema library, and tool-adapter pattern are all locked by Phase 8's scaffold and the milestone-level ARCHITECTURE.md. This phase has no stack decisions left to make.

## `registerTool` API — Verified from installed package types

Confirmed directly from `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DZmmlN8e.d.cts` (the actually-installed `2.3.1` package, not training-data assumption):

```ts
registerTool<...>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;   // a z.object({...}) or a ZodRawShape record
    outputSchema?: OutputArgs; // not used this phase — text-only content
    annotations?: ToolAnnotations;
    icons?: Icon[];
    scopeChallenge?: ScopeChallengeHandler;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>  // async (parsedArgs, ctx) => CallToolResult
): RegisteredTool
```

`CallToolResult`'s `isError` field is confirmed `z.ZodOptional<z.ZodBoolean>` (`node_modules/@modelcontextprotocol/core/dist/auth-V9XJSCfa.d.cts`) — i.e. `{ content: [...], isError: true }` is exactly the documented recoverable-failure shape ARCHITECTURE.md's Pattern 2 assumed, now empirically confirmed against the real installed package rather than SDK docs read before install. `[VERIFIED: installed package type declarations]`.

The raw-shape form (`inputSchema: { field: z.string() }`, auto-wrapped) is marked `@deprecated` in the installed types — **use `z.object({...})` explicitly**, not the bare-record shorthand ARCHITECTURE.md's example implicitly used (`inputSchema: z.object({...})` is already correct there; just don't drop the `z.object()` wrapper for convenience).

The handler callback signature is `(parsedArgs, ctx) => CallToolResult | Promise<CallToolResult>` — note the **second `ctx` parameter** (`ServerContext`), unused by any of the five tools this phase but present in the signature; handlers can safely ignore it (`async (args, _ctx) => {...}` or just omit it if not destructured).

## Exact per-command `compute(args, opts)` signatures — verified by reading each file

All five already live at `src/commands/<name>.js`, confirmed `module.exports = { run, compute }` (plus `lookupPrice`/`computeCost` extras on `cost.js`).

| Command | Signature | Positional args | Flags parsed from `args` array | Notes |
|---------|-----------|------------------|-------------------------------|-------|
| `log.js` | `compute(args, opts = {})` → `string` | none | `--with-prompts`, `--no-cache`, `--json` | No color concerns. Returns a table; MCP param names per D-03: `withPrompts`, `noCache` |
| `show.js` | `compute(args, opts = {})` → `string` | `args.filter(a => a !== '--json' && a !== '--plain')[0]` = turn number (parsed via `parseInt`) | `--with-prompts`, `--json`, `--plain` | **Throws `Usage: git turn show <N>`** if turn arg missing/NaN, `turn ${turnN} not found` if turn doesn't exist. `tool_summary` is in the `--json` output (`meta.tool_summary ?? null`) but **NOT currently printed in the plain-text branch** — see Gap below |
| `diff.js` | `compute(args, opts = {})` → `string` | `positional[0]` = N (required), `positional[1]` = M (optional) | `--json`, `--plain` | Throws `Usage: git turn diff <N> [M]` if N missing/NaN or M present-but-NaN. Throws `turn ${n} not found` per `findTurn()`. D-03 maps optional second turn to `toTurn` |
| `blame.js` | `compute(args, opts = {})` → `string` | first arg not starting with `--` = file path (required) | `--no-cache`, `--json` | Throws `Usage: git turn blame <file> [--no-cache]` if no non-flag arg found. Throws `no history for ${file}` if file untracked+unannotatable. `opts.stderr` sink used for a duplicate-head_sha warning — pass a no-op or `(s) => {}` from the MCP adapter (there's no stderr channel to surface this through in the MCP contract; swallow it, don't let it hit the real `process.stderr`) |
| `cost.js` | `async compute(args, opts = {})` → `Promise<string>` | none | `--all`, `--json`, `--no-cache` | **Async** — handler must `await compute(args)`. `opts.stderr` is used for a `'Fetching pricing data...\r'` progress message (carriage-return overwrite pattern, terminal-only) — again swallow via a no-op sink, not a prop that matters to MCP clients. Throws `could not load pricing data: ...` on network failure |

D-03's camelCase param names map directly: `withPrompts` (log/show), `noCache` (log/blame/cost), `turn` (show/diff first arg), `toTurn` (diff's optional second arg), `all` (cost).

**Error-message contract (MCP-09):** every `compute()` throws a plain `Error` whose `.message` is **exactly** the string the CLI prints via `console.error(e.message)` — confirmed identical in `run()`'s catch block for all five files. The adapter's `isError: true` path must surface `e.message` verbatim (not wrap/reformat it) to satisfy "carrying the CLI's own message text."

## Gap 1 (planner must address): `show.js`'s `tool_summary` is JSON-only today

Success criterion 2 requires `git_turn_show`'s text content to include `tool_summary` when present. Reading `show.js` lines 68-87 (the plain-text branch) confirms: the lines array only ever pushes a header line, `Model:`, `Latency:`, optionally `Prompt:`, then the diff — **no `tool_summary` line exists in the text path today**, even though the `--json` branch already serializes `tool_summary: meta.tool_summary ?? null` (line 58, test-asserted at `show.test.js:258`).

This means satisfying MCP-05/criterion 2 is **not** purely an MCP-adapter task — it requires a small, surgical addition to `show.js`'s plain-text `compute()` branch itself (e.g. `if (meta.tool_summary) lines.push('Tool summary: ' + Object.entries(meta.tool_summary).map(([k,v]) => \`${k}:${v}\`).join(', '))`), which simultaneously and harmlessly changes `git turn show`'s own CLI plain-text output (previously tool_summary was invisible there too — this is a net improvement, not a regression, and there's no existing test asserting tool_summary's *absence* from plain text to break). The planner should scope this as its own task, with its own test (`show.test.js` gets a new assertion that plain-text output includes tool_summary data when present on the note), landing in `src/commands/show.js` — not `src/mcp/tools/show.js`.

## Gap 2 (planner must address): color-off override threading (D-02)

`shouldColor()` (`src/git.js:14-18`) takes **no parameters** — it reads `NO_COLOR`/`FORCE_COLOR`/`process.stdout.isTTY` directly, with no way to force it off from a caller. It's called in two places each in `diff.js` and `show.js`:

- `diff.js`: line 65 (`--plain` branch: `shouldColor() ? '--color=always' : '--color=never'`), line 70 (rich-render branch: `renderRich(raw, { color: shouldColor(), ... })`)
- `show.js`: line 80 (`--plain` branch, same shape), line 84 (rich-render branch, same shape)

**Minimal precise change:** add an optional `opts.color` boolean to `compute(args, opts = {})` in both files. Where each file currently calls `shouldColor()` directly, replace with a small local helper: `const colorOn = opts.color !== undefined ? opts.color : shouldColor();` and use `colorOn` at both call sites. When `opts.color` is omitted (the CLI's own `run()` never passes it), behavior is byte-identical to today — `run()` only ever calls `compute(args, { stderr: ... })`, never setting `color`, so `opts.color === undefined` and the fallback preserves existing CLI behavior exactly (satisfies the "no regression to CLI output" invariant Phase 7's REFACTOR-01 established). The MCP adapters for `git_turn_diff`/`git_turn_show` then call `compute(args, { color: false })` unconditionally — this is the "explicit override that bypasses `shouldColor()`'s `FORCE_COLOR`/`isTTY` check entirely" D-02 requires, verified to work even if the MCP server process inherits `FORCE_COLOR=1` from its spawning shell, since `opts.color === false` short-circuits before `shouldColor()` is ever called.

This is the only permitted `compute()` signature change beyond what's already there (per D-04) — it's additive (new optional `opts` field, default-preserving), not a new positional parameter, and does not touch `log.js`/`blame.js`/`cost.js` at all (none of them touch color).

## Architecture Patterns

### System Architecture Diagram

```
MCP client (e.g. Claude Code)
    │ tools/call { name: "git_turn_show", arguments: { turn: 3, withPrompts: true } }
    ▼
McpServer (src/mcp/server.js createServer()) — routes by registered tool name
    │
    ▼
src/mcp/tools/show.js — zod-validated handler
    │  1. destructure { turn, withPrompts } from parsed args
    │  2. argv = [String(turn), withPrompts && '--with-prompts'].filter(Boolean)
    │  3. try { text = compute(argv, { color: false }) } catch (e) { return isError }
    ▼
src/commands/show.js compute(args, opts)
    │  readSession() → listTurns() → parseSnapshotMessage(sha).headSha (Pitfall 5's
    │  already-fixed resolution — tool handler never touches sha resolution itself)
    │  → gitSafe(['notes','show',head]) → build text (now including tool_summary, Gap 1)
    │  → renderRich(..., { color: opts.color ?? shouldColor() })  (Gap 2)
    ▼
returns string, or throws Error
    │
    ▼
tool handler wraps: { content: [{ type: 'text', text }] }
                  or { content: [{ type: 'text', text: e.message }], isError: true }
    ▼
MCP client renders content
```

### Recommended Project Structure (unchanged from ARCHITECTURE.md, now populated)
```
src/
├── commands/
│   ├── show.js         # MODIFIED: tool_summary in plain text (Gap 1), opts.color (Gap 2)
│   ├── diff.js         # MODIFIED: opts.color (Gap 2) only
│   ├── log.js          # unchanged
│   ├── blame.js        # unchanged
│   └── cost.js         # unchanged
├── mcp/
│   ├── server.js        # MODIFIED: 5 registerTool() calls added inside createServer()
│   └── tools/
│       ├── log.js        # NEW
│       ├── show.js        # NEW
│       ├── diff.js        # NEW
│       ├── blame.js       # NEW
│       └── cost.js        # NEW
```

### Pattern: tool adapter (verified-exact shape for all 5 tools)

**What:** Each `src/mcp/tools/<name>.js` exports `{ register, handler }` — `register(server)` calls `server.registerTool(...)`, and `handler` is the same async function passed as the third `registerTool` argument, exported separately so tests can call it directly without a live stdio transport (per ARCHITECTURE.md's explicit note that handlers are "independently testable without starting a real stdio transport" — confirmed newly necessary here because Phase 8's `mcp.test.js` pattern tests the *server process*, not individual tool logic, and this phase's tests need the latter).

**Worked example — `git_turn_diff` (not already covered by ARCHITECTURE.md's `log` example):**
```js
// src/mcp/tools/diff.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/diff');

async function handler({ turn, toTurn }) {
  const argv = [String(turn), toTurn !== undefined ? String(toTurn) : null].filter(v => v !== null);
  try {
    return { content: [{ type: 'text', text: compute(argv, { color: false }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_diff',
    {
      description: 'Diff turn N-1 vs N, or turn N vs M if toTurn given (mirrors `git turn diff <N> [M]`). Params: turn, toTurn (optional).',
      inputSchema: z.object({
        turn: z.number().int().describe('Turn number to diff'),
        toTurn: z.number().int().optional().describe('Optional second turn number — diffs turn against toTurn directly instead of turn-1 vs turn'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**`git_turn_cost` — the one async + boolean-flag example:**
```js
// src/mcp/tools/cost.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/cost');

async function handler({ all, noCache }) {
  const argv = [all && '--all', noCache && '--no-cache'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: await compute(argv) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_cost',
    {
      description: 'Token usage and cost for the current session (mirrors `git turn cost`). Params: all, noCache.',
      inputSchema: z.object({
        all: z.boolean().optional().describe('Report across all sessions, not just current'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

Note: `cost.js`'s handler is `async` and `await`s `compute()` — the only one of the five that must (the command's own `compute` is declared `async function compute(...)`).

**`git_turn_blame` — the file-path / positional-non-flag-arg case:**
```js
// src/mcp/tools/blame.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/blame');

async function handler({ file, noCache }) {
  const argv = [file, noCache && '--no-cache'].filter(Boolean);
  try {
    // blame.js's opts.stderr is used only for a terminal-only duplicate-sha
    // warning — no-op sink, nothing to surface through the MCP content channel.
    return { content: [{ type: 'text', text: compute(argv, { stderr: () => {} }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_blame',
    {
      description: 'Per-line turn attribution for a file (mirrors `git turn blame <file>`). Params: file, noCache.',
      inputSchema: z.object({
        file: z.string().describe('Path to the file to blame'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

`log` and `show` follow the same shape as ARCHITECTURE.md's existing worked `log` example and the `diff` example above (for `show`, remember to add `turn` as required `z.number()` and pass `{ color: false }` once Gap 2 lands).

### `src/mcp/server.js` after Phase 9 — the registration point
```js
'use strict';
const { McpServer } = require('@modelcontextprotocol/server');
const log = require('./tools/log');
const show = require('./tools/show');
const diff = require('./tools/diff');
const blame = require('./tools/blame');
const cost = require('./tools/cost');

function createServer() {
  const server = new McpServer({ name: 'git-turn', version: require('../../package.json').version });
  log.register(server);
  show.register(server);
  diff.register(server);
  blame.register(server);
  cost.register(server);
  return server;
}

module.exports = { createServer };
```

### Anti-Patterns to Avoid
- **Calling `run()` instead of `compute()` from a tool handler** — already called out in ARCHITECTURE.md Anti-Pattern 2; verified still fully applicable, every `run()` still calls `process.exit(1)` on error.
- **Re-deriving sha resolution inside a tool handler** — Pitfall 5's exact regression class. None of the worked examples above touch sha/notes lookup directly; they only pass argv to `compute()`, which already calls the fixed `parseSnapshotMessage(sha).headSha` path internally.
- **Passing `opts.stderr` through to real `process.stderr.write`** — `blame.js`/`cost.js`'s `opts.stderr` sink exists for terminal progress/warning text with no MCP equivalent; wiring it to the live server's `process.stderr` would work today (stderr is safe for logs in stdio MCP) but adds noise with no consumer — pass a no-op `() => {}` or simply omit `opts` (both files default `opts = {}` and guard every stderr call with `if (opts.stderr)`).
- **Returning `tool_summary` only via a new `--json`-shaped text blob** — don't have the MCP handler call `compute([...argv, '--json'])` and then manually extract/reformat `tool_summary` into prose; that reintroduces a second formatting path. Fix the plain-text branch itself (Gap 1) so both CLI and MCP get the same correct text for free.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| isError-shaped tool failure response | A custom error-wrapping helper reinventing `{ content, isError }` | The literal object shape confirmed from the installed SDK's `CallToolResult` type | It's a two-key object; a helper function is fine for DRY but must match the exact field names already verified above, not an invented convention |
| Zod schema construction | Hand-written JSON Schema | `z.object({...})` per field, matching D-03's camelCase names | `registerTool`'s `inputSchema` expects a Standard Schema (zod satisfies this directly); the SDK converts to JSON Schema internally for `tools/list` |
| Turn/note sha resolution | A new MCP-specific lookup helper | `compute()`'s existing internal calls to `parseSnapshotMessage(sha).headSha` | Pitfall 5 — this is the exact bug class already shipped and fixed twice; never re-derive |

**Key insight:** every "don't hand-roll" item in this phase reduces to the same rule — this phase's new code is a thin translation layer (argv in, `CallToolResult` out) around already-correct, already-tested logic. Any temptation to duplicate logic inside `src/mcp/tools/*.js` (reformatting, re-resolving shas, rebuilding color logic) is the wrong move; push real logic changes into `src/commands/*.js` where Gaps 1 and 2 already require two small, justified exceptions.

## Common Pitfalls

### Pitfall A: Forgetting `cost.js`'s handler must be `async`
**What goes wrong:** `compute(args)` for cost returns a `Promise<string>`; a non-async handler returning that promise unresolved as `text` produces `"[object Promise]"` or a type error depending on how the SDK serializes it.
**Why it happens:** The other four handlers are sync; easy to copy-paste one of those and miss that `cost.js` alone is async.
**How to avoid:** `async function handler(...) { ... text: await compute(argv) ... }` — verified explicitly in the worked example above.
**Warning signs:** `git_turn_cost` tool call returns garbage or a pending-promise-shaped string instead of the cost table.

### Pitfall B: `show`/`diff`'s `--plain` vs rich-render branches both need the color override
**What goes wrong:** Patching only one of the two `shouldColor()` call sites in `show.js`/`diff.js` (e.g. fixing the rich-render branch but not the `--plain` branch, since the MCP tools don't pass `--plain` themselves but a future client-driven variant or test harness fixture might exercise it) leaves a residual path where color can leak.
**Why it happens:** Each file has two near-identical `shouldColor()` call sites (lines noted in Gap 2 above) and it's easy to fix only the default (non-`--plain`) branch since that's what MCP tool calls exercise by default.
**How to avoid:** Fix both call sites with the same `opts.color !== undefined ? opts.color : shouldColor()` helper in one pass; add a test that calls `compute(['1', '--plain'], { color: false })` directly and asserts no ANSI escape codes in the result, not just the default rich-render path.
**Warning signs:** A test asserting color-off only against the default render path, silently leaving `--plain` uncovered.

### Pitfall C: `blame`'s file-arg parsing accepts any non-`--`-prefixed string, including accidentally-stringified numbers
**What goes wrong:** `blame.js`'s `compute()` picks `args.find(a => !a.startsWith('--'))` as the file path — if a zod schema coercion or argv-building bug passes a non-string (e.g. the number itself before `String()`-coercion), `.startsWith` throws a TypeError that is NOT a `compute()`-thrown `Error`, and would propagate out of the `try` block uncaught if the tool handler's `catch` only expects `Error` instances with sensible `.message` — in practice `catch (e) { ... e.message ... }` still works since a `TypeError` has `.message` too, but double-check the zod schema types `file` as `z.string()` so this class of bug can't occur (the schema itself prevents a non-string ever reaching `compute()`).
**Why it happens:** Easy to assume zod validation always guarantees type safety before the handler runs; it does, as long as the schema field type matches what `compute()` expects — verify `file: z.string()`, not `z.any()` or missing entirely.
**How to avoid:** Define every zod field with the correct primitive type (`z.string()`, `z.number().int()`, `z.boolean()`), never `z.any()`; let zod's own validation produce a clean "invalid arguments" protocol error before the handler body even runs (this is automatic SDK behavior for `tools/call` — a schema mismatch never reaches the handler function at all).
**Warning signs:** A handler's own code needing defensive `typeof` checks on destructured args — if that's needed, the zod schema is under-specified, fix the schema instead.

## Code Examples

### `isError` wrapping — exact shape, verified against installed package types
```js
// Source: node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DZmmlN8e.d.cts
// (registerTool's ToolCallback return type is CallToolResult; isError confirmed
//  z.ZodOptional<z.ZodBoolean> in @modelcontextprotocol/core's schema file)
try {
  return { content: [{ type: 'text', text: compute(argv) }] };
} catch (e) {
  return { content: [{ type: 'text', text: e.message }], isError: true };
}
```

### VERIFY-03 live round-trip pattern — adapted from `show.test.js`'s existing `VERIFY-01` tests
```js
// src/mcp/tools/show.test.js (new) — pattern lifted directly from
// show.test.js's seedHookNote()/runWithStdin() helpers (lines 84-96, 35-79),
// adapted to call the exported `handler` directly instead of captureShow().
const { makeTestRepo } = require('../../helpers/test-repo');
const { makeTurn, startSession } = require('../../helpers/turn-fixtures');
const { addNote } = require('../../git');
const { NOTES_REF } = require('../../session');
const { handler } = require('./show'); // the NEW src/mcp/tools/show.js

test('VERIFY-03: git_turn_show reads a real hook-written note, not a hand-built fixture', async () => {
  const repo = makeTestRepo();
  process.chdir(repo.dir);
  const session = startSession();
  const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
  // Simulates exactly what the real post-commit hook + record-prompt would
  // have written — this IS the live round-trip, not a fixture shaped by hand
  // to match what the reader expects.
  addNote(NOTES_REF, headSha, JSON.stringify({
    session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
    model: 'claude-sonnet-4-5', tool_summary: { Read: 2, Edit: 1 },
  }));

  const result = await handler({ turn: 1, withPrompts: false });
  assert.equal(result.isError, undefined);
  const text = result.content[0].text;
  assert.match(text, /claude-sonnet-4-5/);
  assert.match(text, /Read:2/); // or whatever Gap 1's exact tool_summary format renders
});
```

This is the critical acceptance test for VERIFY-03 and should exist for at least `git_turn_show`, `git_turn_log`, and `git_turn_cost` (the three Pitfall-5-affected commands per PITFALLS.md) — not just one.

### Success-path + thrown-error test shape (Build Order Phase C acceptance check, per ARCHITECTURE.md)
```js
// Every tool needs both of these, calling the exported handler directly —
// no live stdio transport required.
test('git_turn_diff success path matches CLI text', async () => {
  // ...seed two turns...
  const result = await handler({ turn: 1 });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].text, require('../../commands/diff').compute(['1'], { color: false }));
});

test('git_turn_diff out-of-range turn returns isError, does not throw', async () => {
  const result = await handler({ turn: 999 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /turn 999 not found/);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ARCHITECTURE.md's milestone-level research assumed the legacy `StdioServerTransport` + manual `server.connect()` pattern | Phase 8 confirmed and shipped `serveStdio(createServer)` from `@modelcontextprotocol/server/stdio` as the actual v2 idiom | Phase 8 (2026-10-26) | No change needed for Phase 9 — tool registration happens inside `createServer()`, upstream of the transport choice either way |
| Raw-shape (`{ field: z.string() }`) `inputSchema` shorthand | Explicit `z.object({...})` wrapping is now the documented, non-deprecated form in the installed `2.3.1` types | Confirmed this session by reading installed `.d.cts` | Use `z.object()` explicitly in all 5 tool files — matches what ARCHITECTURE.md's `log` example already did, just confirmed non-deprecated rather than assumed |

**Deprecated/outdated:** The raw-`ZodRawShape`-record form of `registerTool`'s `inputSchema`/`outputSchema` is marked `@deprecated` in the installed package — don't use it even as a shortcut.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact wording/format for rendering `tool_summary` in `show.js`'s plain-text output (e.g. `"Tool summary: Read:2, Edit:1"`) is left to the planner/implementer's discretion — no existing convention to match since this line doesn't exist yet | Gap 1, Code Examples | Low — any reasonable human-readable rendering satisfies "including the tool_summary field"; only risk is a test asserting one exact string format that the implementation doesn't match, which is a test-authoring detail, not a design risk |
| A2 | `ctx` (second handler parameter, `ServerContext`) can be safely ignored/omitted by all 5 handlers | registerTool API section | Low — confirmed from type signature that `ctx` is purely additional context (auth/session info for HTTP-mode servers); stdio-only read-only tools have no documented need for it |

## Open Questions (RESOLVED)

1. **Exact `tool_summary` text rendering format** — RESOLVED: locked by the planner to `"Tool summary: Read:2, Edit:1"` (09-01), tested exactly.
   - What we know: the data (`{ Read: 2, Edit: 1 }`-shaped object) is already available on `meta.tool_summary` inside `show.js`'s `compute()`, just not rendered to text yet.
   - What's unclear: whether the project wants a terse one-liner (`Tools: Read×2, Edit×1`) or a multi-line list — no existing precedent in this codebase to match.
   - Recommendation: planner picks one terse format (one line, comma-separated `name:count` pairs is simplest and matches the existing `Model:`/`Latency:` one-line-per-field convention already used in `show.js`), implementer writes a test asserting that exact format so it's locked going forward.

2. **Does `src/mcp/tools/*.js` need its own `.test.js` file per tool, or one combined `src/mcp/tools/tools.test.js`?** — RESOLVED: one `.test.js` per tool (09-02/03/05), matching the recommendation below.
   - What we know: `src/commands/*.js` convention is one `.test.js` per command file; ARCHITECTURE.md's recommended structure mirrors one-file-per-tool.
   - What's unclear: whether test file granularity should mirror that 1:1, or group all 5 tools' success/error-path tests into one file since they're thin and mostly identical in shape.
   - Recommendation: mirror the existing 1:1 convention (`src/mcp/tools/show.test.js` next to `show.js`) for consistency with the rest of the codebase's test discovery/listing — plus the mcp.test.js subprocess-isolation lesson from Phase 8 doesn't apply here (these tests call `handler()` directly, no subprocess spawn, so no test-file-isolation concern).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| MCP-04 | `git_turn_log` tool mirrors `git turn log` output, supports withPrompts/noCache | Worked `log` example already in ARCHITECTURE.md Pattern 2; D-03 param names confirmed |
| MCP-05 | `git_turn_show` tool mirrors `git turn show <N>`, including `tool_summary` when present | Gap 1 (surgical `show.js` text-output addition) + worked `show`-shaped example (follow `diff` example's structure, swap in `turn` single-required-param schema) |
| MCP-06 | `git_turn_diff` tool mirrors `git turn diff <N> [M]` | Full worked example provided above, including `toTurn` optional-param handling |
| MCP-07 | `git_turn_blame` tool mirrors `git turn blame <file>` | Full worked example provided above, including file-positional-arg and stderr-sink handling |
| MCP-08 | `git_turn_cost` tool mirrors `git turn cost [--all]` | Full worked example provided above, including the async/await requirement (Pitfall A) |
| MCP-09 | Errors surface as `isError: true` with CLI's exact message, never a thrown exception/crash | Verified `CallToolResult.isError` shape from installed types; every `compute()` throws plain `Error` with CLI-identical `.message`; all 5 worked examples show the `try/catch` wrapper |
| MCP-10 | `show`/`diff` output forced color-off regardless of TTY state | Gap 2 — precise `opts.color` threading design, both call sites in each file identified by line number |
| VERIFY-03 | Live round-trip test (real hook-written note, not hand-built fixture) proves sha-resolution correctness | Code Examples section's adapted `seedHookNote()`-style test; Pitfall 5 cross-reference; recommend covering `show`, `log`, `cost` at minimum |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, no new dependency) |
| Config file | none — `package.json`'s `"test"` script: `node --test $(find src -name '*.test.js' ! -name 'mcp.test.js') && node --test src/commands/mcp.test.js` |
| Quick run command | `node --test src/mcp/tools/<name>.test.js` (per-file, fast — no subprocess spawn needed for this phase's tests) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| MCP-04 | `git_turn_log` success + error path | unit (direct handler call) | `node --test src/mcp/tools/log.test.js` | ❌ Wave 0 |
| MCP-05 | `git_turn_show` success + error + tool_summary-in-text | unit | `node --test src/mcp/tools/show.test.js` | ❌ Wave 0 |
| MCP-06 | `git_turn_diff` success + error + two-turn-form | unit | `node --test src/mcp/tools/diff.test.js` | ❌ Wave 0 |
| MCP-07 | `git_turn_blame` success + error | unit | `node --test src/mcp/tools/blame.test.js` | ❌ Wave 0 |
| MCP-08 | `git_turn_cost` success (async) + error | unit | `node --test src/mcp/tools/cost.test.js` | ❌ Wave 0 |
| MCP-09 | All 5 tools: thrown `Error` → `isError:true` with exact message | unit | same 5 files above, error-path cases | ❌ Wave 0 |
| MCP-10 | `diff`/`show` `compute(args, { color: false })` never emits ANSI | unit (in `src/commands/diff.test.js`/`show.test.js`, testing Gap 2 directly) | `node --test src/commands/diff.test.js src/commands/show.test.js` | existing files, new cases |
| VERIFY-03 | Live round-trip (`addNote` + `makeTurn` fixtures) through `show`/`log`/`cost` handlers | integration (still no subprocess — direct handler call against a real test-repo fixture) | same per-tool `.test.js` files, `VERIFY-03`-tagged test names | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific tool's `node --test src/mcp/tools/<name>.test.js`
- **Per wave merge:** `npm test` (full suite, including the isolated `mcp.test.js` subprocess pass — unaffected by this phase's changes but must stay green)
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/mcp/tools/log.test.js`, `show.test.js`, `diff.test.js`, `blame.test.js`, `cost.test.js` — new files, one per tool, covering success/error/VERIFY-03-round-trip per the map above
- [ ] New test cases added to existing `src/commands/show.test.js` (Gap 1's tool_summary-in-plain-text) and `src/commands/diff.test.js`/`show.test.js` (Gap 2's `opts.color` override) — no new files, additions to existing suites
- [ ] No new test framework/config install needed — `node:test` already fully wired

*(No Wave 0 fixture-helper gaps: `makeTestRepo`/`startSession`/`makeTurn`/`addNote` all already exist in `src/helpers/test-repo.js` and `src/helpers/turn-fixtures.js`, used verbatim by the VERIFY-03 pattern above.)*

## Sources

### Primary (HIGH confidence)
- Direct source read (2026-11-01): `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js` (every `compute()`/`run()` signature, every `shouldColor()` call site, every thrown-`Error` message string)
- Direct source read (2026-11-01): `src/git.js` (`shouldColor()` exact implementation, no param), `src/mcp/server.js`, `src/commands/mcp.js` (Phase 8's actual shipped scaffold)
- Direct read of installed package type declarations (2026-11-01): `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-DZmmlN8e.d.cts` (`registerTool` full signature, `CallToolResult`/`isError` shape, deprecated raw-shape warning), `node_modules/@modelcontextprotocol/core/dist/auth-V9XJSCfa.d.cts` (`isError: z.ZodOptional<z.ZodBoolean>` confirmed)
- Direct source read (2026-11-01): `src/commands/show.test.js` (existing `VERIFY-01` round-trip test pattern, `seedHookNote()`/`runWithStdin()` helpers — basis for this phase's VERIFY-03 adaptation), `src/commands/mcp.test.js` (confirms subprocess-spawn test pattern is Phase-10 scope, not this phase's)
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` (milestone-level, already locked — this research deepens rather than re-derives these)
- `.planning/phases/08-mcp-server-scaffold/08-01-SUMMARY.md`, `08-02-SUMMARY.md`, `08-03-SUMMARY.md` (what Phase 8 actually shipped, verified against current source — no drift found)

### Secondary (MEDIUM confidence)
None — every claim in this document was verified directly against this repo's source or the actually-installed package's type declarations.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, both already installed and verified
- Architecture: HIGH — every pattern verified against actual source, not assumed from milestone-level research
- `registerTool`/`isError` API shape: HIGH — read directly from installed `.d.cts` files, not SDK docs fetched before install
- Pitfalls: HIGH — Gaps 1 and 2 discovered by reading the actual current `show.js`/`diff.js` source, not inferred

**Research date:** 2026-11-01
**Valid until:** 30 days (stable — no fast-moving dependency surface left in this phase; the SDK itself was already pinned and legitimacy-checked in Phase 8)

---
*Research for: Phase 9 - Register Read-Only MCP Tools*
*Researched: 2026-11-01*

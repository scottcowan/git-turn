# Technology Stack

**Project:** git-turn — v0.4 MCP Server addon
**Researched:** 2026-10-07

## ⚠️ Superseded by ARCHITECTURE.md — see resolution note

This document's "hand-roll, zero dependencies" recommendation only evaluated the older,
monolithic `@modelcontextprotocol/sdk` (npm `1.32.1`) and correctly rejected it for its
17 transitive dependencies. It did not discover `@modelcontextprotocol/server` (npm
`2.3.1`, published 2026-04-01, last modified 2026-10-05) — a newer, modular package from
the same MCP SDK family that depends on only `zod` + its own `@modelcontextprotocol/core`
(which itself depends only on `zod`). The architecture researcher found this package and
verified it live (`npm view`, `npm pack`); the team lead independently re-verified the
same facts (`npm view @modelcontextprotocol/server@2.3.1 dependencies`, `exports`,
`time.modified`) before accepting the override.

**Final decision (see ARCHITECTURE.md for full rationale):** take `@modelcontextprotocol/server`
+ `zod` as git-turn's first-ever runtime dependencies — narrowly scoped to the `.` and
`./stdio` exports only, not the heavier legacy `@modelcontextprotocol/sdk`, and not
`ajv`/`zod-to-json-schema`/any HTTP-transport package. The "vendored, not borrowed"
precedent from `src/redact.js` does not apply here the way this document originally
argued: that precedent was for a ~150-line, self-contained problem (regex + Shannon
entropy); hand-rolling JSON-RPC 2.0 framing plus the full MCP capability-negotiation
handshake is not a comparably small problem, and a correctly-scoped official dependency
is the better call. The rest of this document's content (stdio framing details, message
shapes, integration points) remains accurate background even though its top-line
dependency verdict is superseded.

## Original recommendation (superseded): hand-roll the stdio MCP server, do not add `@modelcontextprotocol/sdk`

**Verdict:** Zero new runtime npm dependencies. Implement the MCP stdio transport and the
`tools/list` / `tools/call` protocol surface directly in a new `src/mcp.js` (or
`src/mcp/*.js`), following the same "vendored, not borrowed" precedent already set by
`src/redact.js` (per `PROJECT.md` Key Decisions). Confidence: HIGH — verified against the
npm registry metadata for the official SDK and the current MCP specification docs
(2025-06-18) rather than training-data recall.

### Why not the official SDK

I checked `@modelcontextprotocol/sdk` on the npm registry directly (`registry.npmjs.org`,
version `1.32.1`, `engines.node >= 18`, dual CJS/ESM — `require()` works fine from this
project's CommonJS `bin/git-turn`/`src/commands/*.js` style). It is real, current, and
technically compatible with Node 22.

But its `dependencies` field (not optional peerDeps — these install unconditionally with
`npm install`) is:

```
ajv, zod, cors, hono, jose, express, raw-body, ajv-formats, cross-spawn, eventsource,
content-type, pkce-challenge, @hono/node-server, json-schema-typed, eventsource-parser,
express-rate-limit, zod-to-json-schema
```

That is 17 transitive packages — a full HTTP server stack (Express + Hono), OAuth/JWT
tooling (`jose`, `pkce-challenge`), rate limiting, and a JSON-Schema validation stack
(`ajv`, `zod`) — because the single package bundles support for *every* transport
(stdio, Streamable HTTP, SSE) and the full server+client+auth surface. This milestone
needs exactly one transport (stdio) and 5 read-only tools with trivial inputs (turn
numbers, file paths, flags). Pulling the whole SDK to get `StdioServerTransport` is the
textbook case the project's own "Secret redaction is vendored, not borrowed" decision
already rejected for a smaller problem (`src/redact.js`'s rationale: no existing
dependency fit the narrow need, so vendor a small, auditable implementation instead of
pulling a general-purpose library). The same logic applies here, more strongly, because
the mismatch in scope is much larger (17 packages vs. 5 narrow tool handlers).

### Why hand-rolling is low-risk here

Verified against the official MCP specification (modelcontextprotocol.io,
protocol version `2025-06-18`, fetched directly — not training data):

- **Framing:** stdio transport is newline-delimited JSON-RPC 2.0 over stdin/stdout.
  Messages must not contain embedded newlines; stdout must carry *only* valid MCP
  messages (use stderr for any logging). This is trivial to implement with Node's
  built-in `readline` over `process.stdin` and `process.stdout.write(JSON.stringify(msg) + '\n')`.
- **Required message surface for a read-only, tools-only server** is exactly four
  shapes, all plain JSON-RPC 2.0:
  1. `initialize` (request) → respond with `{protocolVersion, capabilities: {tools: {}}, serverInfo: {name, version}}`
  2. `notifications/initialized` (notification, no response) → no-op
  3. `tools/list` (request) → respond `{tools: [{name, description, inputSchema}, ...]}` — `inputSchema` is a hand-written plain JSON Schema object per tool (e.g. `{type: "object", properties: {n: {type: "integer"}}, required: ["n"]}`), no schema library needed since there are only 5 tools with 1-2 simple parameters each
  4. `tools/call` (request) → dispatch on `params.name`/`params.arguments`, respond `{content: [{type: "text", text: "..."}], isError: false}` (or `isError: true` with an error message in `content` for tool-level failures; use a JSON-RPC `error` object only for protocol-level failures like an unknown tool name or malformed params)
- Optional but cheap to add: respond to `ping` with an empty result; ignore unknown
  notifications (`notifications/cancelled`, etc.) rather than erroring.
- No capability negotiation complexity needed — declare only `tools: {}` (no
  `listChanged`, no `resources`/`prompts`/`sampling`), since this server's tool set is
  static for the process lifetime.

This is on the order of 100-150 lines of vendored protocol glue, not a reimplementation
of MCP — the hard parts (HTTP transport, OAuth, SSE resumability, pagination) that make
the official SDK heavy are exactly the parts this milestone explicitly doesn't need.

## Integration with the existing `bin/git-turn` dispatcher

`bin/git-turn` (lines 8, 44-53) resolves commands by looking up
`src/commands/<cmd>.js` and calling `.run(args)`, exiting nonzero on thrown/rejected
errors. `mcp` fits this pattern directly:

- Add `'mcp'` to the `COMMANDS` array (`bin/git-turn:8`) and to the help text.
- Add `src/commands/mcp.js` exporting `run(args)` that starts the stdio server loop and
  **does not return** until stdin closes (the MCP client manages the subprocess
  lifecycle per the spec's stdio shutdown sequence — client closes stdin, server exits).
  This differs from every other command (`log`, `show`, `cost`, etc.), which run once
  and exit — `mcp.js` is the one long-lived command, so it should not go through the
  same synchronous-exit assumptions the other commands make.
- Each of the 5 tools should **not** shell out to `bin/git-turn log` as a subprocess —
  instead, `mcp.js` should require the same internal modules the CLI commands already
  use (`src/git.js`, `src/session.js`, `src/cache.js`, `src/blame-util.js`) and call
  their logic directly, formatting results as text. This is the one place real
  refactoring is likely needed: `log.js`/`show.js`/`cost.js` currently `console.log`
  directly rather than returning a string (see `src/commands/log.js:17-70`,
  `show.js:33-51`, `cost.js:112-161`). Either (a) factor each command's formatting logic
  into a `format*()` helper that both the CLI path and the MCP tool handler call, or
  (b) capture stdout for the MCP path. (a) is cleaner and is an architecture decision,
  not a stack one — flagged here so the architecture researcher/roadmap phase accounts
  for it.
- `diff` and `blame` map directly to `src/commands/diff.js` and `src/commands/blame.js`
  the same way.

## What NOT to add

| Temptation | Why not |
|---|---|
| `@modelcontextprotocol/sdk` | 17 transitive deps for one transport + 5 tools; see above |
| `express` / `hono` / any HTTP framework | This milestone is stdio-only; Claude Code and other local MCP clients launch the server as a subprocess over stdio, no HTTP listener needed. Streamable HTTP is a separate transport this milestone explicitly does not require (per the milestone's own `git turn mcp` description: "stdio MCP server, scoped to the cwd's repo"). |
| `zod` / `ajv` / any schema validation library | Only 5 tools, each with 1-2 primitive-typed parameters (turn numbers, file paths, boolean flags). Hand-written JSON Schema literals plus a few manual `typeof`/`Number.isInteger` checks cover this; a validation library is disproportionate. |
| `cross-spawn` | Node 22's built-in `child_process` (already used via `execFile` throughout `src/git.js`) is sufficient; no Windows-shell-escaping edge cases are introduced by this milestone. |

## Recommended Stack (net additions)

### Core
| Technology | Version | Purpose | Why |
|---|---|---|---|
| Node.js built-ins only (`readline`, `process.stdin`/`stdout`, `JSON`) | Node 22+ (already required) | stdio framing, JSON-RPC parse/serialize | No new dependency; project already targets Node 22+ |
| Hand-vendored MCP protocol glue (`src/mcp.js` or `src/mcp/*.js`) | n/a (project code) | `initialize`, `tools/list`, `tools/call` handling | Matches `src/redact.js` precedent; protocol is simple and stable (JSON-RPC 2.0 over newline-delimited stdio, spec version 2025-06-18) |

### Supporting Libraries
None. This milestone adds zero new `package.json` dependencies.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| MCP transport/protocol implementation | Hand-vendored stdio JSON-RPC glue | `@modelcontextprotocol/sdk` (official, npm `1.32.1`) | Pulls 17 transitive deps (Express, Hono, jose, ajv, zod, eventsource, etc.) to support HTTP/SSE/OAuth transports and schema validation this milestone never uses; violates project's stated zero/near-zero-dependency posture and its explicit "vendored, not borrowed" precedent for narrow-scope problems |
| Tool input validation | Hand-written JSON Schema literals + manual type checks | `zod` / `ajv` | Only 5 tools, each with 1-2 primitive params; a schema library is overhead without benefit at this scale |
| Command-logic reuse for tool handlers | Direct in-process `require()` of existing `src/*.js` modules, reformatted via small helper functions | Spawning `bin/git-turn <cmd>` as a subprocess per tool call and parsing stdout | Needless subprocess overhead and lossy re-parsing of already-structured data the commands have in memory before they format it for terminal output |

## Installation

```bash
# No new dependencies — nothing to install.
```

## Verified Facts (not training-data recall)

- `@modelcontextprotocol/sdk@1.32.1` dependency list — fetched live from
  `https://registry.npmjs.org/@modelcontextprotocol/sdk/1.32.1` on 2026-10-07.
- MCP stdio transport framing rules (newline-delimited, no stdout pollution, stderr for
  logs) — fetched from `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`
  on 2026-10-07.
- MCP lifecycle (`initialize` → `notifications/initialized` → operation → stdio
  shutdown via stdin close) — fetched from
  `https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle` on 2026-10-07.
- `tools/list` / `tools/call` exact message shapes, `content`/`isError` result format —
  fetched from `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`
  on 2026-10-07.

## Sources

- https://registry.npmjs.org/@modelcontextprotocol/sdk (npm registry metadata, HIGH confidence)
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports (official spec, HIGH confidence)
- https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle (official spec, HIGH confidence)
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools (official spec, HIGH confidence)
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/PROJECT.md` (project context, Key Decisions section)
- `/Users/scowan/Projects/scottcowan/git-turn/bin/git-turn`, `src/commands/log.js`, `src/commands/show.js`, `src/commands/cost.js` (existing dispatch and output patterns)

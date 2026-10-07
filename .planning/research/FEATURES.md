# Feature Research

**Domain:** MCP server addon exposing a CLI's read-only commands as tools (git-turn v0.4)
**Researched:** 2026-10-07
**Confidence:** HIGH on MCP protocol shape and git-turn's existing code (direct inspection + official spec fetch); MEDIUM on "typical CLI-wrapping MCP server" conventions (no live competitor survey of other git-adjacent MCP servers was performed — reasoned from the spec plus git-turn's own documented constraints)

## Existing Architecture This Must Slot Into

This is not a greenfield feature — every finding below is downstream of two hard facts discovered by reading the code directly:

1. **Every command module is `run(args) -> void`, not `run(args) -> data`.** `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js` all write output via bare `console.log`/`console.error` calls and call `process.exit(1)` directly on every error path (not-initialized, bad args, turn not found, no internet for pricing data, etc.). `bin/git-turn` invokes them in-process: `require(cmdPath).run(args)`. **If an MCP tool handler calls `run()` in-process, any error path it hits will call `process.exit(1)` and kill the entire MCP server process**, taking down every other in-flight tool call with it. This is the single most load-bearing finding for this milestone — it rules out the naive "just `require()` the command module and call `.run()`" approach.
2. **There is no `--json` flag anywhere in the CLI today.** AGENTS.md states this explicitly ("there is no `--json` flag yet, so parse text output if you need structured data"), and it's true of every command inspected. The CLI's only existing contract is human-readable plain text on stdout. There is no existing structured-data path to reuse — any structured output in the MCP layer is new surface, not a wrapper around something that already exists.

These two facts, not general MCP best-practice, are what should drive the architecture decision below.

## MCP Protocol Shape (verified against the official 2025-06-18 spec)

- A `Tool` has `name`, optional `title`, `description`, `inputSchema` (JSON Schema), and an **optional** `outputSchema` (JSON Schema). `outputSchema` is opt-in, not required.
- A `tools/call` result returns `content: [...]` — an array of typed blocks (`text`, `image`, `audio`, `resource_link`, `resource`). **Text content is the baseline/always-available mechanism**; nothing else is required.
- **Structured content is additive, not a replacement.** The spec: "a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block" — i.e. `structuredContent` sits alongside `content`, never instead of it. If a tool declares `outputSchema`, the server **MUST** conform; if it doesn't declare one, plain `content` is fully spec-compliant on its own.
- Tool execution errors (as opposed to protocol-level JSON-RPC errors) are reported via `isError: true` inside a normal result, with the error message in a `text` content block — **not** by throwing/crashing the server process. This is the correct MCP-native equivalent of today's CLI pattern of `console.error` + `process.exit(1)`.

This confirms: shipping all 5 tools with **text-only `content`, no `outputSchema`** is fully spec-compliant and matches the milestone's own framing ("mirroring the existing CLI commands' output"). Structured content is a legitimate future enhancement, not a day-one requirement.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `git turn mcp` stdio server subcommand | Milestone's explicit entry point; matches how every other MCP-wrapped CLI tool is invoked (stdio transport, spawned by the MCP client, not a long-running daemon the user starts manually) | LOW | New `src/commands/mcp.js` + registration in `bin/git-turn`'s `COMMANDS` array. Must call `process.stdin`/`stdout` directly for the stdio transport — cannot share stdout with any other command's plain-text output. |
| One tool per existing read command (`git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost`) | Confirmed exact scope from milestone context; 1:1 mapping is the obvious, lowest-surprise shape for an agent client that already knows the CLI from AGENTS.md | LOW (mapping) / MEDIUM (per-tool, see below) | Tool names should match the CLI command names 1:1 (`git_turn_log` not `list_turns`) so an agent that has read AGENTS.md can transfer its mental model directly. |
| Text content output mirroring CLI stdout | Milestone explicitly says "mirroring the existing CLI commands' output"; also the only output shape the CLI has ever produced (no `--json` to diverge from) | LOW | Ship as a single `{type: "text", text: "<exact CLI stdout>"}` block. Do not reformat — any reformatting is a second, unverified presentation layer. |
| Isolate each command's logic from `process.exit` | Hard constraint discovered above — in-process `run()` calls can kill the server | MEDIUM-HIGH | **This is the real engineering cost of the milestone**, not the MCP wiring itself. Two viable approaches, see Architecture Dependencies below. |
| Errors surfaced as `isError: true` tool results, not thrown exceptions | Spec-mandated pattern (see above); matches today's CLI's own "never crash on a bad arg, print an error" philosophy (AGENTS.md's `post-commit.js` precedent: "never crash the commit — log to stderr only") | LOW (once error isolation from `process.exit` is solved) | A turn-not-found or not-initialized error should come back as a normal tool result with `isError: true` and the same message text the CLI would print to stderr, not a protocol-level failure. |
| Repo-scoping to cwd, matching every other `git turn` command | Milestone explicitly states this: "scoped to the cwd's repo (same scoping as every other `git turn` command today)" | LOW | No new design needed — every command already resolves the repo via the ambient `cwd` (`gitSafe`'s `execFile` calls run in the process's cwd). The MCP server process just needs to be launched with the right cwd by the MCP client, same as the CLI binary today. |
| `inputSchema` matching each command's actual argument shape | Non-negotiable per spec — `tools/list` without a usable `inputSchema` makes a tool undiscoverable/unusable by a model | LOW-MEDIUM | See per-tool breakdown below; several of these have more structure than "takes a string" (e.g. `diff` has an optional second integer). |
| Declaring the `tools` server capability (no `listChanged` needed) | Spec-mandated for any server exposing tools at all | LOW | This tool set is static for the life of the process — no case where tools appear/disappear mid-session — so `listChanged: false`/omitted is correct, not a corner cut. |

#### Per-tool `inputSchema` shape (derived directly from each command's argument parsing)

| Tool | Required args | Optional args | Complexity | Source |
|------|---------------|----------------|------------|--------|
| `git_turn_log` | none | `with_prompts: boolean`, `no_cache: boolean` | LOW | `log.js` args: `--with-prompts`, `--no-cache` |
| `git_turn_show` | `turn: integer` | none | LOW | `show.js`: `parseInt(args[0])`, exits with "Usage: git turn show <N>" if `NaN` |
| `git_turn_diff` | `turn: integer` | `compare_to: integer` | LOW | `diff.js`: `N` required, `M` optional — if `M` omitted, diffs `N-1` vs `N` |
| `git_turn_blame` | `file: string` | `no_cache: boolean` | LOW-MEDIUM | `blame.js`: first non-`--` arg is the file path; two internal code paths (tracked vs untracked) are already handled inside the command, transparent to the schema |
| `git_turn_cost` | none | `all: boolean` | LOW | `cost.js` — current session by default, `--all` for cross-session (per AGENTS.md) |

None of these need pagination/filtering parameters added "from day one" beyond what the CLI itself already exposes (see Anti-Features — do not invent new filtering the CLI doesn't have).

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Shared color-stripping for `show`/`diff` | `show.js`/`diff.js` call `shouldColor()` and may emit ANSI codes when run in a TTY; an MCP client is never a TTY, so this needs to be forced off, not detected | LOW | Low effort, meaningfully improves output quality for the model (raw ANSI escape codes in tool-result text actively hurt readability for an LLM consumer, unlike a human terminal). Force `NO_COLOR`-equivalent behavior unconditionally in the MCP code path rather than relying on `shouldColor()`'s TTY detection, which doesn't understand "stdio pipe to an MCP client." |
| `outputSchema` + `structuredContent` for `git_turn_log` and `git_turn_cost` | These two already have obviously tabular, machine-shaped data (turn number, sha, stat; turn/model/tokens/cost) that an agent client would benefit from parsing instead of regexing padded text columns | MEDIUM-HIGH | Real cost: requires either (a) a second presentation layer that calls the same underlying data functions (`listTurns`, `getTurns` from `cache.js`) and shapes them as JSON, independent of the text-formatting code in `log.js`/`cost.js`, or (b) finally adding the long-deferred `--json` flag to the CLI itself (AGENTS.md has flagged its absence twice) and having both the CLI and the MCP tool consume it. Option (b) is the better value: it fixes a documented CLI gap for every future consumer (scripts, CI, other IDE integrations), not just MCP. Treat as a strong v0.4.x fast-follow, not a day-one blocker. |
| Exposing the already-captured `tool_summary` field via `git_turn_show`'s structured output | PROJECT.md flags `tool_summary` as a write-only field today ("captured and persisted but no reader command displays it yet") — the MCP milestone is a natural moment to finally surface it, since it's exactly the kind of structured metadata an agent client (not a human staring at a terminal) benefits from | LOW (data already exists) | Pure upside: zero new capture work, just read `meta.tool_summary` (already in the note) and include it in `git_turn_show`'s result. Flag to roadmap as a one-line addition once `show`'s MCP wrapper is being written anyway. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Exposing `revert`/`bisect`/`redact`/`record-prompt` as MCP tools | "Might as well expose everything the CLI can do" — feels incomplete to leave commands out | Already explicitly rejected by the user for this milestone ("revert is destructive and has no MCP confirmation pattern yet"); `bisect` runs arbitrary shell commands supplied by the caller (same trust boundary as `git bisect run`) — handing that to a model-controlled tool call with no human-in-the-loop confirmation step is a real security hole, not a hypothetical one, per the MCP spec's own warning that destructive tools SHOULD have human confirmation; `redact`/`record-prompt` are write paths with no rollback story at the MCP layer | Ship read-only tools only this milestone (as scoped); revisit `revert`/`bisect` only once an MCP-native confirmation/elicitation pattern exists (the spec has primitives for this — sampling/elicitation — but git-turn doesn't use them yet) |
| Pagination/cursor support on `git_turn_log`'s `inputSchema` "from day one" | MCP's `tools/list` supports a `cursor` pattern, so it's tempting to assume tool *results* should too | The underlying CLI `log` command has no `--limit`/`--since-turn`/`--offset` flags at all — building pagination into the MCP tool's `inputSchema` would create a feature that exists only in the MCP surface and nowhere in the CLI, immediately diverging the two interfaces the milestone explicitly wants to stay mirrored; also most sessions are small (tens of turns, not thousands), so there's no demonstrated need | If/when a real need for large-session pagination shows up, add `--limit`/`--since` to the CLI `log` command first, then mirror it into the MCP tool's schema — never the other way around |
| Calling `run(args)` in-process by `require()`-ing the command module directly | Looks like the "obviously correct," lowest-effort reuse of existing code | Every command module calls `process.exit(1)` on its error paths — doing this inside an MCP tool handler kills the whole long-lived MCP server process on the very first bad argument or not-found turn, taking down every other concurrent tool call with it | Two safer options: (a) spawn the CLI as a child process (`execFile('git', ['turn', cmd, ...args])` or equivalently the `git-turn` bin itself) and capture stdout/stderr/exit code — isolates `process.exit` inside the child, costs one process spawn per tool call, and guarantees byte-identical output to the documented CLI behavior; (b) refactor each command module to separate a pure "compute result" function from the "print and exit" wrapper, call the pure function from both the CLI and the MCP tool. (a) is lower-risk for this milestone (zero changes to 5 already-tested command files + their 217 existing tests); (b) is the more correct long-term shape but is a larger, riskier refactor than "add an MCP server" implies. Recommend (a) for v0.4, flag (b) as a future architectural cleanup if structured `outputSchema` support is pursued later. |
| A new, independent structured-JSON schema invented per tool, disconnected from the CLI's actual text output | Feels like "doing MCP properly" since structured output is in the spec | Builds a second, hand-maintained representation of the same data with no mechanism keeping it in sync with the CLI's real behavior — exactly the kind of drift that already bit this project once (PROJECT.md Phase 6 found `show.js`/`log.js`/`cost.js` had been silently reading notes by the wrong SHA for an entire phase because nothing cross-checked the two paths) | If structured output is wanted, derive it from the same underlying functions (`listTurns`, `cache.getTurns`, `parseSnapshotMessage`) the CLI commands already call — never by regex-parsing the CLI's padded text columns, and never by maintaining a parallel formatter that could drift from the text one |
| Long-running/persistent MCP server process reused across many unrelated repos or cwd changes | Mirrors how some MCP servers are designed to run once and serve many workspaces | git-turn's entire command surface (and the hook it installs) is already scoped to "whatever repo cwd points at" — a persistent server serving multiple repos would need its own repo-switching protocol that doesn't exist anywhere else in git-turn today, and would reintroduce exactly the kind of implicit cross-repo state git-turn has avoided everywhere else | One MCP server process per repo/session, spawned by the client with the right cwd — matches "same scoping as every other `git turn` command today" from the milestone context, zero new state model needed |

## Feature Dependencies

```
git turn mcp (new subcommand)
    └──requires──> stdio transport wiring (new, src/commands/mcp.js or src/mcp/*)
    └──requires──> error isolation from process.exit [BLOCKING — see Anti-Features]

git_turn_log / git_turn_show / git_turn_diff / git_turn_blame / git_turn_cost (5 tools)
    └──requires──> git turn mcp server scaffolding
    └──requires──> error isolation from process.exit (shared blocker across all 5)
    └──requires──> color stripping for show/diff [differentiator, cheap, do alongside]

outputSchema / structuredContent for log, cost (differentiator)
    └──requires──> either a CLI --json flag (preferred) or a parallel JSON-shaping layer
    └──conflicts with──> regex-parsing existing padded text output [anti-feature]

tool_summary surfaced via git_turn_show (differentiator)
    └──requires──> nothing new — field already captured and persisted (Phase 5, v0.3)

revert/bisect/redact/record-prompt as MCP tools (explicitly deferred)
    └──requires──> an MCP confirmation/elicitation pattern that does not exist yet in this codebase
```

### Dependency Notes

- **Every one of the 5 tools shares the same blocking dependency: process-exit isolation.** This is not 5 independent small tasks — it is 1 shared architectural decision (child-process spawn vs. pure-function refactor) applied 5 times. Make that decision once, early, rather than letting it be improvised per-tool.
- **Structured content is explicitly optional per the MCP spec itself** (`outputSchema` is opt-in) — there is no protocol pressure forcing this milestone to add it. The real pressure, if any, should come from "does `--json` already not exist and is overdue" (AGENTS.md flags it twice as a known gap), which argues for treating a CLI-wide `--json` flag as the right vehicle, not an MCP-only bolt-on.
- **`tool_summary` surfacing is a free differentiator** — it requires no new capture work (data already flows in via `record-prompt`, per PROJECT.md), only a one-line addition to whatever renders `git_turn_show`'s result.
- **The destructive-command deferral is final for this milestone, not a placeholder to design around** — do not build an "extensibility hook" for future revert/bisect tools now; that's speculative design for a confirmation pattern that doesn't exist yet (violates the "don't design for hypothetical future requirements" principle, and the milestone context already confirms this was discussed and decided with the user).

## MVP Definition

### Launch With (v1 — this milestone)

- [ ] `git turn mcp` stdio server subcommand, wired into `bin/git-turn`'s `COMMANDS` list — the entry point, nothing works without it
- [ ] Process-exit isolation solved once, applied to all 5 tools (recommend: spawn `git-turn <cmd>` as a child process per tool call, capture stdout/stderr/exit code, map to `isError`) — the actual hard problem of this milestone
- [ ] `git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost` — text-only `content`, no `outputSchema`, `inputSchema` per the per-tool table above
- [ ] Forced color-off for `show`/`diff` output in the MCP path (don't rely on `shouldColor()`'s TTY heuristic)
- [ ] Errors returned as `isError: true` tool results carrying the same message text the CLI prints today, never an unhandled exception or `process.exit`

### Add After Validation (v1.x — natural fast-follows)

- [ ] `tool_summary` surfaced in `git_turn_show`'s text output — free, data already exists, just wasn't wired to any reader yet
- [ ] A CLI-wide `--json` flag (benefits scripts/CI too, not MCP-only), then `outputSchema`/`structuredContent` for `git_turn_log` and `git_turn_cost` built on top of it

### Future Consideration (v2+ — explicitly out of scope)

- [ ] `git_turn_revert`/`bisect`/`redact`/`record-prompt` as MCP tools — defer until an MCP confirmation/elicitation pattern exists in this codebase; explicitly confirmed deferred with the user for this milestone, not a capacity constraint
- [ ] Pagination/filtering params beyond what the CLI itself supports — defer until the CLI itself grows that capability; MCP surface should never get ahead of the CLI surface it mirrors
- [ ] Multi-repo/persistent server reuse across cwd changes — defer indefinitely; no existing git-turn state model supports this and no concrete need has surfaced

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `git turn mcp` entry point | HIGH (nothing works without it) | LOW | P1 |
| Process-exit isolation (child-process spawn approach) | HIGH (blocks all 5 tools; also a latent crash risk if skipped) | MEDIUM | P1 |
| 5 read-only tools w/ text content | HIGH (the entire deliverable) | LOW once isolation is solved | P1 |
| Color stripping for show/diff | MEDIUM (output quality for the model) | LOW | P1 |
| `isError` semantics matching CLI error text | HIGH (correctness/debuggability) | LOW (once isolation decision is made) | P1 |
| `tool_summary` in `show` | LOW-MEDIUM | LOW | P2 |
| CLI-wide `--json` + `outputSchema`/`structuredContent` | MEDIUM-HIGH (real differentiator, benefits non-MCP users too) | MEDIUM-HIGH | P2 |
| revert/bisect/redact/record-prompt as tools | LOW this milestone (explicitly deferred) | HIGH (needs new confirmation primitive) | P3 (deferred by decision, not cost) |
| Custom pagination not in the CLI | LOW (no demonstrated need) | MEDIUM | P3 (reject) |

**Priority key:**
- P1: Must have for launch (this milestone)
- P2: Should have, add when possible (fast-follow, likely still within v0.4.x)
- P3: Nice to have / explicitly deferred or rejected here with reasoning

## Competitor / Prior-Art Feature Analysis

| Aspect | MCP spec's own stated model | git-turn's plan |
|--------|------------------------------|------------------|
| Tool output shape | Text content is baseline; structured content is explicitly optional, additive | Ship text-only for all 5 tools at launch — fully spec-compliant, matches "mirror the CLI" framing, defers the real cost (a JSON representation) to a fast-follow tied to a CLI-wide `--json` flag |
| Error reporting | `isError: true` inside a normal result, not a thrown exception/process crash | Directly motivates solving the `process.exit` isolation problem — this is the one place where git-turn's existing CLI pattern (`console.error` + `process.exit(1)`) is actively incompatible with the MCP contract and must change at the boundary |
| Destructive-operation safety | Spec explicitly recommends human-in-the-loop confirmation for sensitive operations | Validates the user's own decision to defer `revert`/`bisect`/`redact`/`record-prompt` this milestone — not just a cautious choice, but aligned with the protocol's own stated trust model |
| Tool/command naming | No convention mandated by spec beyond uniqueness | 1:1 name mirroring with existing CLI commands (`git_turn_log`, etc.) minimizes surprise for any agent client already primed by AGENTS.md's documented CLI behavior |

## Sources

- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`, `bin/git-turn` — direct code inspection, HIGH confidence (this is the actual system being extended; the `process.exit`-in-`run()` finding and the "no `--json` flag exists" finding both come from reading this code directly, not from AGENTS.md's prose alone)
- `/Users/scowan/Projects/scottcowan/git-turn/AGENTS.md` — documented current CLI behavior for all 5 commands in scope, HIGH confidence (project's own reference doc)
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/PROJECT.md` — milestone scope, confirmed deferrals, `tool_summary` write-only-field tech debt note, HIGH confidence
- Official MCP specification, Tools page, `modelcontextprotocol.io/specification/2025-06-18/server/tools` (fetched 2026-10-07) — HIGH confidence on Tool/CallToolResult shape, `outputSchema` optionality, `isError` error-reporting convention, and the human-in-the-loop recommendation for sensitive tools
- `npm view @modelcontextprotocol/sdk version` (checked 2026-10-07) — confirms `1.32.1` is the current published SDK version, for the stack/architecture researchers' cross-reference; not independently used for feature claims in this document

---
*Feature research for: MCP server addon exposing read-only CLI commands as tools (git-turn v0.4)*
*Researched: 2026-10-07*

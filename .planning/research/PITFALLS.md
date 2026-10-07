# Pitfalls Research: Adding an MCP Server to an Existing CLI (git-turn)

**Domain:** Bolting a stdio MCP server onto an existing synchronous, print-and-exit Node.js CLI that reads git + a SQLite cache
**Researched:** 2026-10-07
**Confidence:** HIGH (code-verified against this repo) / MEDIUM (MCP stdio transport conventions, well-established spec behavior but not independently re-fetched this session)

## Critical Pitfalls

### Pitfall 1: Reusing command modules verbatim corrupts the JSON-RPC stream via stdout

**What goes wrong:**
The MCP stdio transport uses stdout exclusively for framed JSON-RPC messages. Every existing command module in this repo (`src/commands/log.js:17,32,34,37,48,65,68`, and the same pattern in `show.js`/`diff.js`/`blame.js`/`cost.js`) calls `console.log()` directly to print human-formatted text — session banners, padded columns, truncated prompt previews. If an MCP tool handler calls `run(args)` from one of these modules unmodified, that `console.log` output interleaves with (or entirely corrupts) the JSON-RPC frames on stdout, breaking every tool call in the session, not just the one that leaked output.

**Why it happens:**
These modules were designed for exactly one caller shape: a one-shot CLI invocation where stdout *is* the entire user-facing product. There was never a reason to separate "format for a human terminal" from "return structured data" because there was only ever one consumer. Reusing them for MCP tools is the obvious, cheapest-looking path — call the same `run()`, capture the output — and that's precisely what makes the mistake attractive.

**How to avoid:**
Each command module needs its formatting logic split from its data-gathering logic *before* any MCP tool handler is written — e.g. extract `getTurns(session)` / `getTurnDetail(n)` style functions that return plain objects/arrays, with the existing `run()` becoming a thin wrapper that formats and `console.log`s the result. The MCP tool handler calls the data function directly and never calls `run()`. Do not attempt to capture stdout by monkeypatching `console.log` around the `run()` call — this is fragile (any nested async callback, SQLite driver warning, or `child_process` passthrough can bypass the patched reference) and does not solve pitfall 2 below.

**Warning signs:**
Any MCP tool handler that imports a `run` function from `src/commands/*.js` and calls it directly. Any `console.log`/`console.error`/`process.stdout.write` call reachable from a tool handler's code path. Garbled or truncated JSON-RPC responses in an MCP client log, especially ones that look like two responses concatenated.

**Phase to address:**
Must be solved in the first MCP phase, before any tool handler is written — not retrofitted. The extraction of data-returning functions from each of the five target commands (`log`, `show`, `diff`, `blame`, `cost`) is itself phase-0 prerequisite work, not part of "wire up the MCP server" work.

---

### Pitfall 2: Dependencies print to stdout/stderr independently of your own code

**What goes wrong:**
Even after extracting clean data functions, two things in this codebase write to the console on their own initiative, outside the command module's control: `src/cache.js` installs a `process.on('warning', ...)` listener and calls `process.removeAllListeners('warning')` at module load to suppress Node's `node:sqlite` experimental-API warning (`src/cache.js:7-10`) — any warning Node emits that doesn't match the SQLite filter gets re-emitted via `process.emitWarning`, which by default prints to **stderr**, not stdout, so it's not a protocol-corruption risk by itself, but it establishes that this module already assumes it's the only thing calling `process.on('warning', ...)` in the process. In a long-running MCP server, re-requiring `cache.js` doesn't re-run that listener registration (module cache), but any *other* dependency that logs via `console.log` instead of `console.error`/`process.stderr.write` — including a future npm dependency added for MCP SDK plumbing itself, or `git`/`gitSafe` stderr-suppression gaps (several `gitSafe` calls pass `{ stdio: ['pipe', 'pipe', 'ignore'] }` explicitly, implying some callers do NOT suppress stderr and rely on it leaking to the terminal) — is a live risk once the process is long-running and shared across many tool calls instead of exiting after one.

**Why it happens:**
A one-shot CLI doesn't care if a dependency prints a stray line to stdout — it's indistinguishable from the command's own intentional output and the process exits immediately after. In a persistent server, any stdout write from *any* code path (including transitive dependencies) during the server's lifetime corrupts the stream for every subsequent message, not just the triggering call.

**How to avoid:**
Audit every module reachable from the five target data functions (`git.js`, `cache.js`, `session.js`, `blame-util.js`, plus the `node:sqlite` driver and whatever MCP SDK package is chosen) for any stdout write that isn't the deliberate JSON-RPC framing layer. Treat `console.log` as banned inside the MCP process for anything except the transport layer itself; redirect genuinely necessary diagnostic output to stderr. Confirm the chosen MCP SDK's stdio transport (if using `@modelcontextprotocol/sdk`'s `StdioServerTransport`) does not itself get confused by stray stderr output — stderr is conventionally safe for logs, but verify against the SDK version actually installed, not assumed from memory.

**Warning signs:**
Any `require()` of a module that calls `process.on('warning', ...)`, `console.log`, or writes to `process.stdout` at module-load time rather than inside an exported function. Protocol errors that only appear after several tool calls (suggesting a warning or lazy-loaded dependency, not an immediate bug).

**Phase to address:**
Same phase as Pitfall 1 — audit transitively, not just the five command modules directly.

---

### Pitfall 3: Long-running process reuses `process.exit()` patterns designed for one-shot execution

**What goes wrong:**
Every existing command module calls `process.exit(1)` liberally on error paths — confirmed in all of `bisect.js`, `blame.js`, `cost.js`, `diff.js`, `export.js`, `gc.js`, `init.js`, `log.js`, `record-prompt.js`, `redact.js`, `redo.js`, `revert.js`, `session.js`, `show.js`, `status.js` (dozens of call sites across the codebase). If any extracted data function — or a helper it still shares with the CLI path, like `readSession()` throwing and a `catch` block calling `process.exit(1)` — is invoked from an MCP tool handler, a single bad tool call (e.g. "not initialized" or "turn not found") kills the entire MCP server process, not just that one request. Every other open tool call in flight, and the client's whole session, dies with it.

**Why it happens:**
`process.exit(1)` + a stderr message is the correct, idiomatic pattern for a CLI that should fail fast and set a shell-visible exit code. It is actively wrong for a server where "this specific request was invalid" must become a JSON-RPC error response, not a process death.

**How to avoid:**
The data functions extracted for Pitfall 1 must never call `process.exit()` — they should throw ordinary `Error` objects (or return a typed error/result) that the MCP tool handler catches and converts into an MCP error response. This means the extraction can't be a mechanical copy-paste of the existing `run()` body; every `process.exit(1)` call site needs to become a `throw`. Keep the CLI's own `run()` wrapper calling `process.exit()` as before — only the new data layer must be exit-free.

**Warning signs:**
Grep for `process.exit` reachable from any file imported by the MCP tool-handler module. An MCP client reporting "server disconnected" after a single malformed or edge-case tool call (e.g. asking for a turn number that doesn't exist) is the live symptom.

**Phase to address:**
Same extraction phase as Pitfall 1 — this is really one piece of work ("make the five commands' logic exit-free and stdout-free, callable as library functions") with three distinct failure modes, not three separate fixes.

---

### Pitfall 4: cwd/repo-scoping drift between server startup and per-call expectations

**What goes wrong:**
Every git-turn command resolves its target repo via `process.cwd()` — directly (`src/commands/init.js:85`, `src/commands/export.js:45`) or indirectly through `git.js`'s `gitSafe`/`repoRoot` helpers, which default `cwd: opts.cwd || process.cwd()` (`src/git.js:23`) and fall back to `process.cwd()` again if `rev-parse --show-toplevel` fails (`src/git.js:54`). A one-shot CLI's cwd is fixed for its entire (sub-second) lifetime. An MCP stdio server is a persistent process launched once by the client (e.g. Claude Code) and then receives many tool calls over its lifetime — its cwd is whatever it was at server launch, and nothing in Node changes it unless something explicitly calls `process.chdir()`. If the MCP client's own working directory changes between tool calls (e.g. the user or agent `cd`s to a different repo mid-session, or the MCP server is accidentally shared across multiple repos by a client that doesn't restart it per-repo), every tool call still silently resolves against the *original* launch-time repo, producing results for the wrong repository with no error — the exact "wrong commit sha, same shape of bug" class covered by Pitfall 5.

**Why it happens:**
The milestone's own framing — "scoped to the cwd's repo (same scoping as every other `git turn` command today)" — treats cwd-scoping as free continuity from the CLI, but the CLI's cwd-per-invocation model and a server's cwd-per-process-lifetime model are not the same guarantee. The CLI re-reads cwd on every invocation (a new process each time); the server reads it once, at best, or on every tool call always returns the launch-time value if nothing ever calls `chdir()`.

**How to avoid:**
Decide and document explicitly, before writing the server: cwd is captured once at `git turn mcp` startup and is immutable for the server's lifetime (simplest, matches "no `cd` tool exists in MCP" reality for most clients) — not re-read per call, since `process.cwd()` inside a tool handler returns the same value anyway unless something calls `chdir()`, which nothing should. Validate at startup (not per-call) that cwd resolves to a valid git-turn-initialized repo, and fail the server start loudly (stderr) rather than failing each tool call individually. If multi-repo support per server process is ever desired, that is a distinct, larger design (passing a repo path per tool call) — do not half-implement it by reading `process.cwd()` fresh per call and calling it "scoping."

**Warning signs:**
Any test that starts the MCP server, changes directory, and then makes a tool call expecting the new directory to take effect. Any tool call result that doesn't match `git turn status` run manually in the directory the user believes is active.

**Phase to address:**
The MCP server bootstrap phase — cwd capture and startup-time repo validation should be the very first thing `git turn mcp` does, before registering any tools.

---

### Pitfall 5: Reintroducing the snapshot-sha-vs-HEAD-sha notes lookup bug in a new code path

**What goes wrong:**
This exact bug class has already shipped and been fixed twice in this project's history (per `.planning/RETROSPECTIVE.md`'s v0.2 and v0.3 entries): `show.js`/`log.js`/`cost.js` looked up `refs/notes/git-turn` using the dangling *snapshot* commit sha instead of the real *HEAD* commit sha where the post-commit hook actually writes notes — so for weeks/months, `--with-prompts` and friends silently returned nothing even though the data existed. The fix (`parseSnapshotMessage(sha).headSha`, visible in `src/commands/log.js:52-55`) is now correctly applied in the existing CLI commands, but it is exactly the kind of easy-to-drop detail when a new consumer (an MCP tool handler) is built by someone who copies the "look up the turn, read its sha, fetch the note" shape without reading why `log.js` has that comment. A naive MCP `git_turn_show`/`git_turn_log`/`git_turn_cost` implementation that re-derives notes lookup from `listTurns()`'s raw `sha` field instead of routing through `parseSnapshotMessage()` would silently reintroduce the identical defect a third time — and because it returns an *empty* result rather than an error, it is exactly the kind of bug that passes unit tests against fixtures that don't exercise the real head/snapshot sha distinction.

**Why it happens:**
`listTurns()` returns `{ turn_n, sha }` where `sha` is the *snapshot* ref target, not the HEAD commit — a naming/shape trap that has already fooled three separate command implementations in this codebase before being caught, per the retrospective's own "Key Lessons" ("A note-writer's own unit tests passing is not sufficient evidence that the readers consuming the same ref can actually see the data").

**How to avoid:**
Do not write new sha-resolution logic for the MCP tools. The data-extraction work in Pitfall 1 should literally reuse the already-fixed resolution path from `log.js`/`show.js`/`cost.js` (which already call `parseSnapshotMessage(sha).headSha`) rather than re-deriving it against `listTurns()`'s raw output. If the extraction refactor produces a shared `resolveHeadSha(turn)` helper used by both the CLI and MCP paths, that is the correct outcome — one lookup implementation, two callers, matching this project's own established "one primitive, N consumers" pattern (`updateNote()`, `shouldColor()`, `reachableFrom()`).
Follow this project's own established practice from the v0.3 retrospective: pair write-path and read-path verification with a live round-trip check (write a real note via the hook, then call the new MCP tool against it) rather than trusting unit tests against hand-built fixtures alone.

**Warning signs:**
Any new MCP-specific helper that reads `listTurns()[i].sha` and passes it directly to a notes lookup without routing through `parseSnapshotMessage()`. An MCP tool call for `git_turn_show`/`git_turn_log` that returns turn metadata but an empty/missing prompt field for a turn that `git turn show <N> --with-prompts` (CLI) shows has a captured prompt.

**Phase to address:**
The data-extraction phase (same as Pitfalls 1 and 3) — explicitly require that extracted functions call the existing, already-fixed sha-resolution helper rather than reimplementing lookup logic, and require a live round-trip test (real hook-written note -> MCP tool call) as an exit criterion for this phase, mirroring the v0.3 audit's own methodology.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Monkeypatch `console.log` around existing `run()` calls instead of extracting data functions | Fast to ship, no changes to existing commands | Fragile against nested/async writes, any dependency's own stdout write still corrupts the stream, doesn't fix `process.exit()` risk (Pitfall 3) | Never — this is the exact shape of bug this research exists to prevent |
| Re-read `process.cwd()` fresh on every tool call instead of capturing at startup | "Feels" more correct/dynamic | Creates false confidence that per-call repo-switching works, when nothing actually changes cwd mid-process | Only acceptable if a `chdir`-capable tool is deliberately added later, with its own tests |
| Skip the live round-trip test (real note write -> MCP read) and rely on hand-built fixtures only | Faster to write, matches normal unit-test style | This exact gap let the sha-resolution bug ship twice already in this codebase (v0.2, v0.3) | Never, for any tool touching `refs/notes/git-turn` |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| MCP SDK stdio transport (e.g. `@modelcontextprotocol/sdk`'s `StdioServerTransport`) | Assuming the SDK "handles" stdout isolation for you, so any `console.log` elsewhere is fine | The SDK only owns the exact bytes it writes for JSON-RPC framing on stdout; it has no way to intercept or sandbox stdout writes from unrelated application code in the same process — isolation is the application's responsibility |
| `node:sqlite` (`src/cache.js`) | Assuming the experimental-warning suppression (`process.removeAllListeners('warning')`) is harmless in a server context | It's stderr-only today (safe), but it's a global process-wide listener mutation done once at module load — confirm no other long-lived MCP code later needs its own `'warning'` listener, since this module already claims that global hook unconditionally |
| `git` subprocess calls via `gitSafe`/`execFile` | Assuming stderr from spawned `git` is always suppressed | Several call sites explicitly pass `{ stdio: ['pipe', 'pipe', 'ignore'] }` to suppress stderr; others don't — in a persistent server, un-suppressed git stderr (e.g. a corrupt-ref warning) lands on the *server's* stderr, not a user's terminal, so review whether that's still the desired behavior once there's no human watching the terminal live |

## "Looks Done But Isn't" Checklist

- [ ] **Data extraction from `log`/`show`/`diff`/`blame`/`cost`:** Looks done once the MCP tool returns *some* JSON — verify it returns the same facts as the CLI command run against the same repo/turn, not just "doesn't crash"
- [ ] **Error handling:** Looks done once a happy-path tool call works — verify an invalid turn number, an uninitialized repo, and a missing cache all produce a proper MCP error response, not a server crash (Pitfall 3)
- [ ] **Prompt/note data in `git_turn_show`/`git_turn_log`/`git_turn_cost`:** Looks done once *a* prompt field appears for *some* turn — verify specifically against a turn whose note was written by the real post-commit hook + `record-prompt`, not a hand-built fixture, to catch Pitfall 5's bug class
- [ ] **cwd scoping:** Looks done once the server works in the repo it happened to be launched in — verify behavior (ideally: a clear startup-time error) when launched outside any git-turn-initialized repo

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|---------------|
| stdout pollution from reused command modules | Data-extraction phase (before any MCP tool handler is written) | Run the MCP server, pipe its stdout through a strict JSON-RPC line parser during the full tool-call test suite; any parse failure is a regression |
| transitive dependency stdout/stderr writes | Same data-extraction phase | Audit `require()` graph of the five extracted functions for module-load-time console/stdout writes; add a lint rule or test that fails on `console.log` anywhere under the new MCP tool-handler path |
| `process.exit()` reuse killing the server | Same data-extraction phase | Grep extracted functions for `process.exit`; integration test that an invalid tool call (bad turn number) returns an MCP error and the server is still alive for the next call |
| cwd/repo-scoping drift | MCP server bootstrap phase | Test: start server in repo A, assert tool calls never pick up a cwd change; test: start server outside any initialized repo, assert a clear startup-time failure |
| snapshot-sha-vs-HEAD-sha notes lookup regression | Same data-extraction phase | Live round-trip test: real commit -> post-commit hook writes note -> `record-prompt` -> MCP tool call reads back the same prompt/usage data the CLI equivalent shows |

## Sources

- `/Users/scowan/Projects/scottcowan/git-turn/.planning/RETROSPECTIVE.md` — v0.2 "What Was Inefficient" (notes `head` field bug), v0.3 "What Was Inefficient" and "Key Lessons" (sha-resolution bug shipped and sat silent through Phase 5's own verification)
- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/log.js` — direct `console.log` usage pattern (lines 17, 32, 34, 37, 48, 65, 68) and the already-fixed `parseSnapshotMessage(sha).headSha` resolution (lines 52-55)
- `/Users/scowan/Projects/scottcowan/git-turn/src/git.js` — `shouldColor()` (NO_COLOR/FORCE_COLOR/isTTY gate, lines 11-17), `gitSafe` cwd defaulting (line 23), `repoRoot` cwd fallback (line 54)
- `/Users/scowan/Projects/scottcowan/git-turn/src/cache.js` — module-load-time `process.on('warning', ...)` global listener mutation (lines 7-10)
- `process.exit()` call-site survey across all 16 files in `/Users/scowan/Projects/scottcowan/git-turn/src/commands/*.js` (grep-verified, dozens of call sites) — HIGH confidence, directly observed in this codebase
- MCP stdio transport stdout-exclusivity convention (JSON-RPC framing over stdout, logs must go to stderr) — MEDIUM confidence; this is well-established, widely documented MCP specification behavior from training knowledge, not independently re-verified against current `modelcontextprotocol.io` docs this session. Recommend a quick confirmation against the specific MCP SDK version pinned for this milestone before implementation.

---
*Pitfalls research for: adding a stdio MCP server to the existing git-turn CLI*
*Researched: 2026-10-07*

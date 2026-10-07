# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- ✅ **v0.2 Read Cache + Blame/Bisect** — Phases 1-3, 03.1 (shipped 2026-09-17)
- ✅ **v0.3 Prompt Capture** — Phases 4-6 (shipped 2026-10-01)
- 📋 **v0.4 MCP Server** — Phases 7-10 (planned)
- 📋 **v1.0 Warren Integration** — Phase 11 (planned)

## Phases

<details>
<summary>✅ v0.1 Working CLI (Phase 1) — SHIPPED 2026-08-09</summary>

**Goal:** Complete the v0.1 CLI surface — all 8 commands working end-to-end with a full test suite.

- [x] Phase 1: Core commands — 6/6 plans complete (completed 2026-08-09)

Archive: `.planning/milestones/v0.1-ROADMAP.md`

</details>

<details>
<summary>✅ v0.2 Read Cache + Blame/Bisect (Phases 2-3, 03.1) — SHIPPED 2026-09-17</summary>

**Goal:** Fast cached reads, real blame/bisect at turn granularity, and a turn-activity heatmap.

- [x] Phase 2: SQLite read cache — shipped ad hoc (completed 2026-08-18)
- [x] Phase 3: bisect + blame — 4/4 plans complete (completed 2026-09-07)
- [x] Phase 03.1: Turn heatmap — 4/4 plans complete (completed 2026-09-08)

Archive: `.planning/milestones/v0.2-ROADMAP.md`, audit: `.planning/milestones/v0.2-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v0.3 Prompt Capture (Phases 4-6) — SHIPPED 2026-10-01</summary>

**Goal:** Persist prompt/model/latency/usage metadata per turn, safely — with mandatory secret redaction on the write path and end-to-end verification against real data.

- [x] Phase 4: Secret Redaction Scanner — 1/1 plan complete (completed 2026-09-17)
- [x] Phase 5: record-prompt Note-Write Path — 3/3 plans complete (completed 2026-09-20)
- [x] Phase 6: Verification, Redact Command & Purge Procedure — 4/4 plans complete (completed 2026-09-21)

Archive: `.planning/milestones/v0.3-ROADMAP.md`, requirements: `.planning/milestones/v0.3-REQUIREMENTS.md`, audit: `.planning/milestones/v0.3-MILESTONE-AUDIT.md`

</details>

### 📋 v0.4 MCP Server (Phases 7-10)

- [ ] **Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output** - Extract pure `compute()` functions from `log`/`show`/`diff`/`blame`/`cost`, make the full-line-highlight diff renderer the default (`--plain` restores today's output), and add a CLI-wide `--json` flag
- [ ] **Phase 8: MCP Server Scaffold** - `git turn mcp` starts a stdio MCP server with zero tools registered
- [ ] **Phase 9: Register Read-Only MCP Tools** - Wire up `git_turn_log`, `_show`, `_diff`, `_blame`, `_cost` as MCP tools
- [ ] **Phase 10: End-to-End Verification with a Real MCP Client** - Claude Code exercises all 5 tools against a real session

### 📋 v1.0 Warren Integration (Phase 11)

- [ ] **Phase 11: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Phase Details

### Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output

**Goal**: `log`/`show`/`diff`/`blame`/`cost` each expose a pure, in-process-callable `compute()` function; `diff`/`show` get a richer default rendering with a `--plain` escape hatch; and a `--json` output mode is available on all 5.
**Depends on**: Phase 6
**Requirements**: REFACTOR-01, DIFF-01, JSON-01
**Success Criteria** (what must be TRUE):

  1. Each of `log`/`show`/`diff`/`blame`/`cost` exports a `compute(args)` that returns a string (or `Promise<string>` for `cost`) and throws `Error` on failure, instead of calling `process.exit`/`console.log` directly.
  2. Running `diff`/`show` with `--plain`, with any arguments, produces byte-identical stdout and exit codes to today's `git diff --color=always`-passthrough behavior (existing test suite passes with zero test-file edits against the `--plain` path).
  3. Running `diff`/`show` without `--plain` (the new default) renders full-row ANSI background highlighting per added/removed line, a line-number gutter, and an "Added N / removed M" summary header, respecting `NO_COLOR`/`FORCE_COLOR` the same way today's output does.
  4. Running any of these 5 commands with `--json` emits structured JSON instead of formatted text, usable by scripts/CI independent of MCP.

**Plans**: TBD

### Phase 8: MCP Server Scaffold

**Goal**: `git turn mcp` starts a long-running stdio MCP server, correctly scoped to the invoking repo, with no tools registered yet.
**Depends on**: Phase 7
**Requirements**: MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):

  1. Running `git turn mcp` inside a git-turn-initialized repo starts a stdio server that completes the `initialize`/`notifications/initialized` handshake with a real MCP client.
  2. Running `git turn mcp` inside a repo that has never run `git turn init` fails loudly on stderr and exits, without leaving a server process running.
  3. The server stays alive while its stdio stream is open and exits cleanly when stdin closes or on SIGINT, without being killed by any `process.exit` call reachable from its code path.
  4. The server captures cwd once at startup and never re-resolves the repo per tool call.

**Plans**: TBD

### Phase 9: Register Read-Only MCP Tools

**Goal**: An MCP client sees and can successfully call all 5 read-only git-turn tools, with output matching the CLI and errors surfaced safely.
**Depends on**: Phase 7, Phase 8
**Requirements**: MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09, MCP-10, VERIFY-03
**Success Criteria** (what must be TRUE):

  1. An MCP client calling `tools/list` sees `git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, and `git_turn_cost`.
  2. Calling each tool against a real session returns the same text content the equivalent CLI command prints today, including the `tool_summary` field in `git_turn_show` when present on the turn's note.
  3. Calling a tool with a bad argument (e.g. an out-of-range turn number, or against an uninitialized repo) returns an `isError: true` result carrying the CLI's own message text, without throwing or crashing the server.
  4. `git_turn_show`/`git_turn_diff` output is always colorless, regardless of the server process's TTY state.
  5. A live round-trip test — a real hook-written note read back through each tool, not a hand-built fixture — proves correct note/sha resolution, closing out the snapshot-sha-vs-HEAD-sha bug class that has shipped and been fixed twice before (v0.2, v0.3).

**Plans**: TBD

### Phase 10: End-to-End Verification with a Real MCP Client

**Goal**: A real MCP client (Claude Code) can drive git-turn's full read-only tool surface against real data, including graceful recovery from tool errors.
**Depends on**: Phase 9
**Requirements**: VERIFY-04
**Success Criteria** (what must be TRUE):

  1. Claude Code, connected to `git turn mcp` as a real MCP client, successfully calls all 5 tools against a real session with real turns.
  2. An out-of-range turn number or an uninitialized-repo condition surfaces to Claude Code as a recoverable tool error, not a server crash or dropped connection.
  3. After a tool error, a subsequent unrelated tool call in the same session still succeeds.

**Plans**: TBD

### Phase 11: Warren integration

**Goal**: `git turn branch --from <N>` creates a warren workspace branched from a specific turn.
**Depends on**: Phase 10, Warren API availability
**Requirements**: TBD (scoped at v1.0 planning)
**Success Criteria** (what must be TRUE):

  1. TBD — scoped at v1.0 planning, blocked on the Warren API.

**Plans**: Not yet planned.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Core commands | v0.1 | 6/6 | Complete | 2026-08-09 |
| 2. SQLite read cache | v0.2 | shipped (ungoverned) | Complete | 2026-08-18 |
| 3. bisect + blame | v0.2 | 4/4 | Complete | 2026-09-07 |
| 03.1. Turn heatmap | v0.2 | 4/4 | Complete | 2026-09-08 |
| 4. Secret redaction scanner | v0.3 | 1/1 | Complete    | 2026-09-17 |
| 5. record-prompt note-write path | v0.3 | 3/3 | Complete    | 2026-09-20 |
| 6. Verification, redact command & purge procedure | v0.3 | 4/4 | Complete    | 2026-09-21 |
| 7. Compute/run split, rich diff rendering & CLI JSON output | v0.4 | 0/? | Planned | — |
| 8. MCP server scaffold | v0.4 | 0/? | Planned | — |
| 9. Register read-only MCP tools | v0.4 | 0/? | Planned | — |
| 10. End-to-end verification with a real MCP client | v0.4 | 0/? | Planned | — |
| 11. Warren integration | v1.0 | 0/? | Planned | — |

Also shipped ad hoc, untracked by any phase (same pattern as Phase 2's SQLite cache): `session new`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — commit `7b446ce`, 2026-09-06.

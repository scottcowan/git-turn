# Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Three deliverables on the same five command files (`log`/`show`/`diff`/`blame`/`cost`):

1. **REFACTOR-01** — each command exports a `compute(args)` that returns a string (or `Promise<string>` for `cost`) and throws `Error` instead of calling `console.log`/`console.error`/`process.exit`. `run(args)` becomes a thin CLI wrapper. This is the hard prerequisite for Phase 8/9's MCP server — nothing reachable from `compute()` may write to stdout or exit the process.
2. **DIFF-01** — `diff`/`show` get a richer default renderer (full-row ANSI background highlight, line-number gutter, summary header). `--plain` restores today's exact `git diff --color=always`/`--color=never` passthrough output.
3. **JSON-01** — a `--json` flag on all five commands emits structured JSON instead of formatted text.

No MCP code in this phase. No new npm dependencies in this phase (`@modelcontextprotocol/server` + `zod` arrive in Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Rich diff visual style (DIFF-01)
- **D-01:** Gutter shows **new-file line numbers only** — one right-aligned column. No old-file column (rejected two-column side-by-side style).
- **D-02:** The "Added N / removed M" summary header goes at the **top**, before the diff body (matches `git --stat` convention and delta/diff-so-fancy).
- **D-03:** Rich rendering must respect `NO_COLOR`/`FORCE_COLOR`/TTY exactly the way today's output does via `shouldColor()`. When color is off, the rich renderer still emits the gutter and summary header, just without ANSI codes.

### `--plain` scope
- **D-04:** `--plain` is recognized **only by `diff` and `show`** — the two commands whose rendering actually changes. `log`/`blame`/`cost` do not accept it (no rich-vs-plain distinction to toggle). AGENTS.md should document `--plain` as diff/show-specific.
- **D-05:** REFACTOR-01's "byte-identical output" acceptance criterion is verified against `diff --plain`/`show --plain` (and the unflagged default for `log`/`blame`/`cost`, which don't change). Existing `diff`/`show` tests that assert on output should pass when pointed at the `--plain` path.

### `--json` output shape (JSON-01)
- **D-06:** **Natural shape per command**, no shared envelope. E.g. `log --json` → array of turn objects; `cost --json` → `{ turns: [...], total_cost, ... }`; `show --json` → turn metadata + diff. Each command's shape is optimized for its own data (docker/kubectl-style per-subcommand JSON), not forced into a `{command, data, meta}` wrapper.

### Error handling in `--json` mode
- **D-07:** When a command fails with `--json` set, it prints a **JSON error object to stdout** — `{"error": "<same message text the CLI prints today>"}` — and exits 1. Scripts can always `JSON.parse(stdout)` regardless of success/failure. Without `--json`, error behavior is unchanged (plain text to stderr, exit 1).
- This falls naturally out of the compute/run split: `compute()` throws `Error`, and `run()` decides how to present it (stderr text vs. stdout JSON) based on `--json`.

### Claude's Discretion
- Exact field names and nesting inside each command's `--json` shape (D-06 sets the principle, planner/researcher define the schema per command — should be documented in AGENTS.md).
- Exact ANSI background colors for added/removed rows and the gutter's dim styling.
- Whether `--json` + `--plain` together is meaningful (likely `--json` wins and `--plain` is ignored — diff content in JSON should be raw unified diff text, uncolored).
- Whether the rich renderer is a new module (e.g. `src/diff-render.js`) shared by `diff.js`/`show.js`, or inline — a shared module is the obvious fit since both commands need it.
- Whether to hand-parse unified diff hunks or use `git diff` plumbing flags to simplify parsing — planner's call; zero new npm deps for this phase either way.
- How `cost.js`'s `process.stderr.write('Fetching pricing data...\r')` progress indicator is handled under the split — it's stderr (not stdout), so it doesn't corrupt a future MCP stdio stream, but planner should decide whether `compute()` keeps it or moves it to `run()`.

### Folded Todos
- **`.planning/todos/pending/2026-09-07-rich-diff-renderer.md`** ("Richer full-line-highlight diff renderer for show/diff") — folded per explicit user direction, now requirement DIFF-01 (tagged `resolves_phase: 7`). Original problem: `git diff --color=always` is foreground-only, no gutter, no summary line, vs. the reference style (Claude Code's side-panel diff viewer: full-row background highlight, line-number gutter, "Added N lines, removed M lines" header). The todo's prior-art pointers (`diff-so-fancy`, `delta`) still apply. Conflict with REFACTOR-01's byte-identical bar resolved by D-04/D-05: rich is the new default, `--plain` is the byte-identical path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — storage model, Key Decisions (execFile only, no shell interpolation), Current Milestone v0.4 section
- `.planning/REQUIREMENTS.md` — REFACTOR-01, DIFF-01, JSON-01 (this phase's mapped requirements)
- `.planning/ROADMAP.md` §Phase 7 — goal, 4 success criteria

### Research (milestone v0.4)
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (compute/run split, with a worked `log.js` example), Anti-Pattern 2 (leaving `process.exit` reachable), Build Order Phase A acceptance check
- `.planning/research/PITFALLS.md` — Pitfalls 1-3 (stdout pollution, transitive dependency writes in `src/cache.js`/`gitSafe`, `process.exit` reuse) and Pitfall 5 (sha-resolution regression — `compute()` must reuse `parseSnapshotMessage(sha).headSha` verbatim)
- `.planning/research/SUMMARY.md` — Phase 1 (= this Phase 7) rationale and "Avoids" list
- `.planning/research/FEATURES.md` — recommends CLI-wide `--json` over a parallel MCP-only JSON layer (avoids two-path drift)

### Folded todo
- `.planning/todos/pending/2026-09-07-rich-diff-renderer.md` — reference style description and prior art (`diff-so-fancy`, `delta`)

### Existing code (read this session)
- `src/commands/diff.js` — `process.exit(1)` at lines 12/18/26/36 (inside nested `findTurn`), `shouldColor()` → `--color=always|never` at line 54
- `src/commands/show.js` — `parseSnapshotMessage(turn.sha).headSha` sha resolution (lines 24-25, already correct — preserve), `--with-prompts` gate, same diff passthrough as diff.js (lines 42-51), duplicated empty-tree constant
- `src/commands/log.js` — cache-first + `--no-cache` fallback, `parseSnapshotMessage` resolution in fallback path (lines 54-55), early `return` inside the cache branch
- `src/commands/cost.js` — `async run()`, `process.exit(1)` on pricing failure (line 97), stderr progress write (lines 91/93), `lookupPrice`/`computeCost` already pure helpers
- `src/commands/blame.js` — not read this session; planner must audit for the same `console.log`/`process.exit` patterns
- `bin/git-turn` — `require(cmdPath).run(args)` dispatch with promise-aware `.catch` (lines 50-53); `--help` text needs `--plain`/`--json` documented
- `AGENTS.md` — currently states "there is no `--json` flag yet" and documents diff/show colorization — both must be updated

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `shouldColor()` in `src/git.js` — the NO_COLOR > FORCE_COLOR > isTTY gate; reuse in the rich renderer (D-03)
- `parseSnapshotMessage()` in `src/blame-util.js` — the single source of truth for snapshot → HEAD sha; `compute()` functions must keep calling it, not re-derive
- `src/blame-util.js` already has a unified-diff parser (built for blame's untracked-file fallback in v0.2) — candidate for reuse in the rich diff renderer's hunk parsing
- `lookupPrice()`/`computeCost()` in `cost.js` — already pure, no change needed

### Established Patterns
- `'use strict'`, plain functions, `module.exports = { ... }`, `node:test` sibling test files
- Zero runtime npm dependencies (still true through this phase)
- `gitSafe()` returns `''`/null on failure rather than throwing; some call sites pass `stdio: ['pipe','pipe','ignore']` to suppress stderr, others don't — audit when extracting `compute()`
- Empty-tree SHA `4b825dc...` duplicated in diff.js and show.js — natural to consolidate when extracting the shared renderer

### Integration Points
- `src/commands/{log,show,diff,blame,cost}.js` — modified (compute/run split, `--json`, `--plain` on diff/show)
- New shared diff renderer module (likely `src/diff-render.js` + test) — consumed by diff.js and show.js
- `bin/git-turn` — `--help` text updates only; dispatch mechanism unchanged
- `AGENTS.md`, README — document `--json` shapes, `--plain`, new default diff rendering

</code_context>

<specifics>
## Specific Ideas

- Reference look for the rich renderer: Claude Code's own side-panel diff viewer — full-row background highlight per added/removed line, line-number gutter, "Added N lines, removed M lines" summary.
- The user's framing, verbatim: "rich diff by default and --plain or something gives you the existing one."

</specifics>

<deferred>
## Deferred Ideas

None new from this discussion.

### Reviewed Todos (not folded)
- `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` — keyword-matched (score 0.2, only on "change"); initially selected for folding, then reconsidered — it's a SHA-anchoring robustness research exploration unrelated to a mechanical refactor/rendering/JSON phase. Stays in backlog.

</deferred>

---

*Phase: 7-Compute/Run Split, Rich Diff Rendering & CLI JSON Output*
*Context gathered: 2026-10-08*

# git-turn

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

**Tech stack:** Node.js, git CLI (no libgit2), optional SQLite for read cache

**Repo:** https://github.com/scottcowan/git-turn

## What it is

A git extension (`git turn <cmd>`) that automatically groups agent commits into turns and makes them queryable. Works with any AI coding agent that makes git commits (Claude Code, Cursor, Aider, opencode).

## Storage model

- **Refs** — `refs/git-turn/sessions/{id}/turn-{N}` point at dangling snapshot commits
- **Snapshots** — dangling `commit-tree` commits with two trees: index state + full worktree (including untracked)
- **Notes** — `refs/notes/git-turn` stores `{session_id, turn_n, snapshot_sha, ts}` per turn on the HEAD commit, plus `prompt`/`model`/`usage`/`latency_ms`/`tool_summary` once `git turn record-prompt` (Phase 5) is run — merged via `updateNote()`'s read-merge-write helper, never a blind overwrite
- **Session meta** — `refs/git-turn/sessions/{id}/meta` durable per-session metadata (fork lineage via `session new --from`), survives after the session is no longer active
- **Op log** — `.git/git-turn/ops/` content-addressed operation log (jj-style) for undo/redo
- **SQLite cache** — shipped (`src/cache.js`, `d591cff`) — read cache for fast `log`/`cost` reads, rebuilt via `gc --rebuild` or automatically if stale

## Key Decisions

- **Forensics-first** — primary use is audit ("which turn broke this?"), not undo
- **No server required** — everything in local git object store and refs
- **No shell interpolation** — all git calls via `execFile(git, args[])`, never string concat
- **Hook fires on every commit** — serialized via pending-promise to prevent concurrent writes
- **Read-only turns skipped** — no commit = no snapshot (Option 1)
- **Separate from warren** — works in any git repo; warren is optional for `git turn branch`
- **Secret redaction is vendored, not borrowed** — warren has no content/regex secret detector (only an encrypted credential store), so `src/redact.js` (Phase 4) is a hand-vendored regex + Shannon-entropy scanner modeled on gitleaks/trufflehog patterns, zero new npm dependencies

## Current State

**Shipped:** v0.3 (Prompt Capture) as of 2026-10-01 — see `.planning/milestones/v0.3-ROADMAP.md`, `.planning/milestones/v0.3-REQUIREMENTS.md`, and `.planning/milestones/v0.3-MILESTONE-AUDIT.md` (audit: passed, 9/9 requirements, all 4 E2E flows verified live). Covers v0.1 (Working CLI) through v0.3 (Prompt Capture): SQLite read cache, real `blame`/`bisect` at turn granularity, calendar-grid heatmap, colorized diff output, session fork lineage (`session new --from`), cross-repo `export`, and now per-turn prompt/model/usage/latency capture with mandatory secret redaction.

15 commands working end-to-end: `init`, `log`, `show`, `diff`, `blame`, `bisect`, `revert`, `redo`, `status`, `gc`, `cost`, `session` (new/list), `export`, `heatmap`, `record-prompt`, `redact`. Full test suite (217 tests). Hook installs via absolute path for cross-repo compatibility, and respects `core.hooksPath` (Husky/lefthook) instead of assuming the default hooks dir.

**v0.3 delivered (Phases 4-6):**
- **Phase 4** — `src/redact.js`: standalone, zero-dependency secret scanner (`redact(text) -> { text, count }`) covering 9 vendor-prefixed categories (AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM, generic key=value) plus a Shannon-entropy fallback for unstructured tokens, with a SHA/UUID whitelist to avoid false-positive redaction of legitimate git identifiers. Validated against realistic fixtures (22 tests) with documented false-negative behavior.
- **Phase 5** — `git turn record-prompt`: reads a JSON payload on stdin (`{prompt, model, usage, latency_ms, tool_summary}`, all optional), redacts `prompt` through Phase 4's scanner, resolves the latest turn via `listTurns()`/`parseSnapshotMessage()` (never bare `HEAD`), and merges into the note via a new `updateNote(ref, sha, patchFn)` read-compare-retry helper in `src/git.js` (never a blind overwrite of the hook's fields). `usage` is stored verbatim in Anthropic's four-key shape; `tool_summary` is a per-tool call-count breakdown. SQLite cache extended with `usage`/`tool_summary` columns and a narrow `updatePromptFields()` writer.
- **Phase 6** — found and fixed a real, previously-masked defect: `show.js`/`log.js`/`cost.js` looked up `refs/notes/git-turn` by the snapshot commit sha instead of the real HEAD commit sha where notes are actually written, so none of them ever saw Phase 5's real data until this phase's fix. Added `show.js`'s missing `--with-prompts` gate (matching `log.js`). Shipped `git turn redact <N>` (scrubs only the `prompt` field via `updateNote()`, no confirmation, matching `revert`/`redo` style) and `git turn gc --purge-notes` (`purgeNotesHistory()`: collapses notes history to a parentless commit, then reflog-expire + `gc --prune=now` — empirically verified the naive reflog-expire+gc-only sequence does NOT remove an old note blob, since `refs/notes/*` is a linear commit chain outside `git filter-repo`/BFG's coverage). Also fixed a real pre-existing bug in `cost.js`'s Bedrock cross-region pricing lookup (double-prefixed, unmatchable key).

**Phase 7 complete (2026-10-13):** `log`/`show`/`diff`/`blame`/`cost` each now export a pure `compute(args)` (returns a string, throws `Error`, zero `console`/`process.exit`/`process.stderr` calls — verified by a dedicated out-of-process purity probe, `src/helpers/compute-purity-probe.js`) alongside the existing `run(args)` CLI wrapper. This is the prerequisite for Phase 8's MCP server. `diff`/`show` ship a new rich default renderer (`src/diff-render.js`: full-row ANSI background highlight, line-number gutter, "Added N / removed M" summary header) with a `--plain` flag restoring the exact byte-identical pre-phase output. All 5 commands gained a `--json` flag emitting structured, per-command-shaped output, with a uniform `{"error": "..."}` + exit 1 contract on failure. 59 new tests (286 total). The phase's one human checkpoint (visual rich-render approval) was approved after structural/escape-code verification in a scratch repo.

**Not yet implemented:** `branch --from <N>` (Phase 11 of v1.0, blocked on the Warren API). MCP server scaffold + tools (Phases 8-10, v0.4) — in progress.

**Known issues:** `cost --all` is parsed but silently never applied — reports current-session data regardless of the flag, contradicting AGENTS.md's documented behavior (pre-existing bug, found during Phase 7 planning and confirmed again by Phase 7's code review; tracked as a todo, not yet fixed). Phase 7's code review also flagged non-blocking robustness gaps carried forward as tech debt: `cost.js`'s cost math can propagate `NaN` from malformed `usage` fields in a note; `diff-render.js`'s gutter-width calculation could throw `RangeError` on extremely large diffs (array-spread over line numbers); `blame-util.js`'s untracked-file lookup breaks on filenames containing a colon. From v0.3: `tool_summary` is captured and persisted but no reader command displays it yet (write-only field); `log --no-cache` computes its diff stat against the snapshot sha instead of the real HEAD sha. See `.planning/todos/pending/` for other open work (mindwalk integration exploration, stable change-identity research — both deferred).

## Current Milestone: v0.4 MCP Server

**Goal:** Claude Code (and other MCP clients) can drive git-turn's read-side via an MCP addon, without any destructive tool surface.

**Target features:**
- `git turn mcp` — new subcommand starting a stdio MCP server, scoped to the cwd's repo (same scoping as every other `git turn` command today)
- `git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost` — read-only MCP tools mirroring the existing CLI commands' output
- Explicitly deferred this milestone: `git_turn_revert` (destructive — no confirmation/dry-run pattern exists yet for MCP tool calls), `bisect`, `redact`, `record-prompt` (write/destructive ops)
- Packaged inside the existing `git-turn` package/bin — no separate npm package to version and publish

**Progress:** Phase 7 (compute/run split, rich diff rendering, CLI `--json`) complete — the prerequisite refactor is done. Phases 8-10 (MCP server scaffold, tool registration, E2E verification) remain. Phase 8 will add `@modelcontextprotocol/server` + `zod` as git-turn's first-ever runtime dependencies (narrowly scoped, verified against the npm registry during v0.4 research — see `.planning/research/STACK.md`).

## Prior art

- pi-rewind (arpagon) — dangling commit-tree, two-tree snapshot, pending-promise pattern
- copilot-timeline-session (mmcs-work) — untracked exclusion, hash-keyed sidecar
- Jujutsu — content-addressed op log, op restore via update-ref only

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-13 after Phase 7 completion*

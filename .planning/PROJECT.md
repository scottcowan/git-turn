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
- **MCP surface is read-only** — `git_turn_log/show/diff/blame/cost` only; destructive and write ops stay CLI-only until an MCP confirmation pattern exists (v0.4)
- **MCP tools are thin adapters over `compute()`** — one code path for CLI and MCP, so tool output matches CLI text exactly and tool errors carry the CLI's own message as `isError` results (v0.4)
- **Notes are keyed by the real HEAD commit, never the snapshot sha** — this bug class shipped three times (v0.2, v0.3, v0.4); unresolved heads now skip the note lookup instead of falling back (v0.4)

## Current State

**Shipped:** v0.4 (MCP Server) as of 2026-11-11 — see `.planning/milestones/v0.4-ROADMAP.md`, `.planning/milestones/v0.4-REQUIREMENTS.md`, and `.planning/milestones/v0.4-MILESTONE-AUDIT.md` (audit: tech_debt, 16/16 requirements, no blockers; the debt was cleared in Phase 10.1). Earlier milestones: v0.1 Working CLI, v0.2 Read Cache + Blame/Bisect, v0.3 Prompt Capture (archives under `.planning/milestones/`).

17 commands working end to end: `init`, `log`, `show`, `diff`, `blame`, `bisect`, `revert`, `redo`, `status`, `gc`, `cost`, `session` (new/list), `export`, `heatmap`, `record-prompt`, `redact`, plus `mcp`. 369 tests (357 main suite + 12 in `mcp.test.js`, run as its own pass). The hook installs via absolute path and respects `core.hooksPath` (Husky/lefthook).

**Capabilities by milestone:**
- **v0.1–v0.2:** snapshot-per-commit turns, `log`/`show`/`diff`, `revert`/`redo`, SQLite read cache, `blame`/`bisect` at turn granularity, calendar heatmap, session fork lineage, cross-repo `export`.
- **v0.3:** per-turn prompt/model/usage/latency capture via `record-prompt`, mandatory vendored secret redaction (`src/redact.js`), `redact <N>` and `gc --purge-notes` for after-the-fact remediation.
- **v0.4:** every read command exposes a pure `compute()` and a `--json` mode; `diff`/`show` default to a rich renderer (`--plain` restores the old output); `git turn mcp` is a stdio MCP server with five read-only tools (`git_turn_log`, `_show`, `_diff`, `_blame`, `_cost`), verified against a real Claude Code client. `@modelcontextprotocol/server` and `zod` are the project's only runtime dependencies. Destructive and write operations (`revert`, `bisect`, `redact`, `record-prompt`) are deliberately not exposed over MCP.

**Not yet implemented:** `branch --from <N>` (Phase 11, v1.0), blocked on the Warren API.

**Known issues / deferred:**
- `git turn init` in a repo with no commits prints `fatal: ambiguous argument 'HEAD'` to stderr but continues (pre-existing, outside v0.4).
- Phase 7 info-level leftovers: `blame` treats filenames starting with `--` as flags; a dead `line === ''` branch in `parseDiff()`.
- Backlog todos in `.planning/todos/pending/`: mindwalk integration, stable change-identity research, a Claude Code Stop-hook for automatic `record-prompt` capture, and an opt-in `install-global-hook` command.

## Next Milestone Goals

Not yet scoped. Candidates: v1.0 Warren integration (`git turn branch --from N`, blocked on the Warren API), a Stop-hook so prompt capture is automatic rather than caller-driven, and the deferred write/destructive MCP tools once a confirmation pattern exists. Start with `/gsd-new-milestone`.

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
*Last updated: 2026-11-11 after v0.4 milestone*

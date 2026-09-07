# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- ✅ **v0.2 Read Cache + Blame/Bisect** — Phase 2 (2026-08-18), Phase 3 (2026-09-07)
- 📋 **v0.3 Prompt Capture + MCP** — Phases 4-5 (planned)
- 📋 **v1.0 Warren Integration** — Phase 6 (planned)

## Phases

<details>
<summary>✅ v0.1 Working CLI (Phase 1) — SHIPPED 2026-08-09</summary>

**Goal:** Complete the v0.1 CLI surface — all 8 commands working end-to-end with a full test suite.

- [x] Phase 1: Core commands — 6/6 plans complete (completed 2026-08-09)
  - [x] 01-01: Foundation: test infra + diff command (D-04, D-05, D-12)
  - [x] 01-02: Read commands: status + init format blob (D-06, D-07, D-11)
  - [x] 01-03: Mutation pair: revert + redo (D-01, D-02, D-03)
  - [x] 01-04: GC command (D-08, D-09, D-10)
  - [x] 01-05: Tests for diff, status, init
  - [x] 01-06: Tests for revert, redo, gc

Archive: `.planning/milestones/v0.1-ROADMAP.md`

</details>

### 📋 v0.2 Read Cache + Blame/Bisect (Phases 2-3)

- [ ] **Phase 2: SQLite read cache** — fast log/blame/bisect without walking git objects; rebuild from notes on startup
- [x] **Phase 3: bisect + blame** — `git turn bisect <cmd>`, `git turn blame <file>` (completed 2026-09-07)

### 📋 v0.3 Prompt Capture + MCP (Phases 4-5)

- [ ] **Phase 4: Prompt capture** — `git turn record-prompt`, note storage, `--with-prompts` flag on log/show
- [ ] **Phase 5: MCP server** — Claude Code addon, `git_turn_log`, `git_turn_show`, `git_turn_revert` tools

### 📋 v1.0 Warren Integration (Phase 6)

- [ ] **Phase 6: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Phase Details

### Phase 2: SQLite read cache

**Goal**: Fast `log`/`cost` reads without walking refs/notes on every invocation.
**Depends on**: Phase 1
**Success Criteria** (what must be TRUE):

  1. `git turn log` and `git turn cost` read from a SQLite cache (node:sqlite) instead of scanning `refs/notes/git-turn` directly
  2. Cache updates incrementally on each new turn (post-commit hook), no full rebuild per commit
  3. `git turn gc --rebuild` rebuilds the cache from `refs/notes/git-turn` from scratch
  4. `--no-cache` flag on `log` bypasses the cache for a direct read

**Plans**: Shipped ad hoc (commit d591cff), not planned/executed via GSD

Plans:

- [x] Shipped directly: `src/cache.js`, wired into `log.js`, `gc.js`, `post-commit.js` (2026-08-18)

### Phase 3: bisect + blame

**Goal**: `git turn bisect <cmd>` and `git turn blame <file>` — locate which turn introduced a regression or last touched a line, at turn granularity.
**Depends on**: Phase 2
**Success Criteria** (what must be TRUE):

  1. `git turn blame <file>` reports, per line, which turn (session + turn number) last modified it
  2. `git turn bisect <cmd>` binary-searches turn snapshots, running `<cmd>` against each candidate, and reports the first turn where `<cmd>` fails
  3. Both commands read from the SQLite cache (Phase 2) where available, falling back to refs/notes
  4. Both commands are documented in README.md and AGENTS.md, replacing the "not yet implemented" note

**Plans**: 4 plans in 3 waves

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Cross-session foundation: multi-session test fixtures, `cache.getAllTurns()`, `src/blame-util.js` (turn enumeration, head_sha index, topology order, ancestry filter, hunk + porcelain parsers, untracked annotator) [wave 1] (D-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — `git turn blame <file>`: per-line attribution via real `git blame` + head_sha→turn index, cross-session scope, untracked-snapshot fallback [wave 2] (D-01, D-02)
- [x] 03-03-PLAN.md — `git turn bisect <cmd>`: clean-worktree gate, binary search over HEAD-reachable candidates, live progress, guaranteed restore, exit-code convention [wave 2] (D-03, D-04, D-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04-PLAN.md — Docs: README.md + AGENTS.md + `--help`, replacing the "not yet implemented" notes; human verification of output legibility [wave 3]

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Core commands | v0.1 | 6/6 | Complete | 2026-08-09 |
| 2. SQLite read cache | v0.2 | shipped (ungoverned) | Complete | 2026-08-18 |
| 3. bisect + blame | v0.2 | 4/4 | Complete    | 2026-09-07 |
| 03.1. Turn heatmap | v0.2 | 1/3 | In Progress|  |
| 4. Prompt capture | v0.3 | 0/? | Planned | — |
| 5. MCP server | v0.3 | 0/? | Planned | — |
| 6. Warren integration | v1.0 | 0/? | Planned | — |

Also shipped ad hoc, untracked by any phase (same pattern as Phase 2's SQLite cache): `session new`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — commit `7b446ce`, 2026-09-06.

### Phase 03.1: Turn heatmap — calendar grid of turn activity by model/agent (INSERTED)

**Goal:** `git turn heatmap` — a calendar-grid ANSI heatmap of turn activity across all sessions, colored by daily turn-count density, with an activity-summary block below the grid. One-shot plain-text CLI print, zero new dependencies.
**Requirements**: D-01 (color by per-day turn count, not model/cost), D-02 (cross-session scope), D-03 (all-time, no `--since` flag), D-04 (activity-only summary stats) — see `03.1-CONTEXT.md`
**Depends on:** Phase 3
**Plans:** 1/3 plans executed

Plans:
**Wave 1**

- [x] 03.1-01-PLAN.md — Pure core: local-date day bucketing, data-relative density levels, activity summary stats, bounded week-column grid model + width fitting; `src/commands/heatmap.test.js` created (D-01, D-02, D-03, D-04) [wave 1]

**Wave 2** *(blocked on Wave 1)*

- [ ] 03.1-02-PLAN.md — Rendering + command: ANSI/ASCII cells with `shouldColor()` gating, month/weekday labels, Less→More legend, summary block, `run(args)` via `listAllTurns({ noCache })`, cross-session multi-day integration test (D-01, D-02, D-03, D-04) [wave 2]

**Wave 3** *(blocked on Wave 2)*

- [ ] 03.1-03-PLAN.md — Wire `heatmap` into `bin/git-turn` COMMANDS + `--help`, document in README.md and AGENTS.md, human verification of terminal legibility across widths and color modes [wave 3]

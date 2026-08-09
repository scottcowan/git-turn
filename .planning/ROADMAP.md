# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- 📋 **v0.2 Read Cache + Blame/Bisect** — Phases 2-3 (planned)
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
- [ ] **Phase 3: bisect + blame** — `git turn bisect <cmd>`, `git turn blame <file>`

### 📋 v0.3 Prompt Capture + MCP (Phases 4-5)

- [ ] **Phase 4: Prompt capture** — `git turn record-prompt`, note storage, `--with-prompts` flag on log/show
- [ ] **Phase 5: MCP server** — Claude Code addon, `git_turn_log`, `git_turn_show`, `git_turn_revert` tools

### 📋 v1.0 Warren Integration (Phase 6)

- [ ] **Phase 6: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Core commands | v0.1 | 6/6 | Complete | 2026-08-09 |
| 2. SQLite read cache | v0.2 | 0/? | Planned | — |
| 3. bisect + blame | v0.2 | 0/? | Planned | — |
| 4. Prompt capture | v0.3 | 0/? | Planned | — |
| 5. MCP server | v0.3 | 0/? | Planned | — |
| 6. Warren integration | v1.0 | 0/? | Planned | — |

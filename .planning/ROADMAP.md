# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- ✅ **v0.2 Read Cache + Blame/Bisect** — Phases 1-3, 03.1 (shipped 2026-09-17)
- ✅ **v0.3 Prompt Capture** — Phases 4-6 (shipped 2026-10-01)
- ✅ **v0.4 MCP Server** — Phases 7-10, 10.1 (shipped 2026-11-11)
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

<details>
<summary>✅ v0.4 MCP Server (Phases 7-10, 10.1) — SHIPPED 2026-11-11</summary>

**Goal:** Claude Code (and other MCP clients) can drive git-turn's read side over stdio, without any destructive tool surface.

- [x] Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output — 5/5 plans complete (completed 2026-10-13)
- [x] Phase 8: MCP Server Scaffold — 3/3 plans complete (completed 2026-10-26)
- [x] Phase 9: Register Read-Only MCP Tools — 5/5 plans complete (completed 2026-11-01)
- [x] Phase 10: End-to-End Verification with a Real MCP Client — 1/1 plan complete (completed 2026-11-10)
- [x] Phase 10.1: Address v0.4 tech debt (INSERTED) — 4/4 plans complete (completed 2026-11-10)

Archive: `.planning/milestones/v0.4-ROADMAP.md`, requirements: `.planning/milestones/v0.4-REQUIREMENTS.md`, audit: `.planning/milestones/v0.4-MILESTONE-AUDIT.md`

</details>

### 📋 v1.0 Warren Integration (Phase 11)

- [ ] **Phase 11: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Phase Details

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
| 7. Compute/run split, rich diff rendering & CLI JSON output | v0.4 | 5/5 | Complete    | 2026-10-13 |
| 8. MCP server scaffold | v0.4 | 3/3 | Complete   | 2026-10-26 |
| 9. Register read-only MCP tools | v0.4 | 5/5 | Complete   | 2026-11-01 |
| 10. End-to-end verification with a real MCP client | v0.4 | 1/1 | Complete   | 2026-11-10 |
| 10.1. Address v0.4 tech debt | v0.4 | 4/4 | Complete   | 2026-11-10 |
| 11. Warren integration | v1.0 | 0/? | Planned | — |

Also shipped ad hoc, untracked by any phase (same pattern as Phase 2's SQLite cache): `session new`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — commit `7b446ce`, 2026-09-06.

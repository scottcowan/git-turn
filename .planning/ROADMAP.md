# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- ✅ **v0.2 Read Cache + Blame/Bisect** — Phases 1-3, 03.1 (shipped 2026-09-17)
- 📋 **v0.3 Prompt Capture + MCP** — Phases 4-5 (planned)
- 📋 **v1.0 Warren Integration** — Phase 6 (planned)

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

### 📋 v0.3 Prompt Capture + MCP (Phases 4-5)

- [ ] **Phase 4: Prompt capture** — `git turn record-prompt`, note storage, `--with-prompts` flag on log/show
- [ ] **Phase 5: MCP server** — Claude Code addon, `git_turn_log`, `git_turn_show`, `git_turn_revert` tools

### 📋 v1.0 Warren Integration (Phase 6)

- [ ] **Phase 6: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Phase Details

### Phase 4: Prompt capture

**Goal:** `git turn record-prompt`, note storage for prompt/model/latency/usage, `--with-prompts` flag on `log`/`show`.
**Depends on:** Phase 3
**Locked requirement (folded in 2026-09-10, not a separate phase):** Secret redaction — before any prompt/response content is written into `refs/notes/git-turn`, scan for likely secrets (API keys, high-entropy tokens) and redact matches. This must be built into the same code path that adds prompt-writing from the start, not bolted on after. Reuse whatever secret pattern list warren's secret store maintains rather than inventing a new one. See `.planning/todos/pending/2026-09-06-secret-redaction-on-notes.md` for full rationale (also covers an alternative/complementary `git turn redact <N>` post-hoc command).
**Plans:** Not yet planned.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Core commands | v0.1 | 6/6 | Complete | 2026-08-09 |
| 2. SQLite read cache | v0.2 | shipped (ungoverned) | Complete | 2026-08-18 |
| 3. bisect + blame | v0.2 | 4/4 | Complete | 2026-09-07 |
| 03.1. Turn heatmap | v0.2 | 4/4 | Complete | 2026-09-08 |
| 4. Prompt capture | v0.3 | 0/? | Planned | — |
| 5. MCP server | v0.3 | 0/? | Planned | — |
| 6. Warren integration | v1.0 | 0/? | Planned | — |

Also shipped ad hoc, untracked by any phase (same pattern as Phase 2's SQLite cache): `session new`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — commit `7b446ce`, 2026-09-06.

# Roadmap: git-turn

## Milestones

- ✅ **v0.1 Working CLI** — Phase 1 (shipped 2026-08-09)
- ✅ **v0.2 Read Cache + Blame/Bisect** — Phases 1-3, 03.1 (shipped 2026-09-17)
- 📋 **v0.3 Prompt Capture** — Phases 4-6 (planned)
- 📋 **v0.4 MCP Server** — Phase 7 (planned)
- 📋 **v1.0 Warren Integration** — Phase 8 (planned)

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

### 📋 v0.3 Prompt Capture (Phases 4-6)

**Milestone Goal:** Persist prompt/model/latency/usage metadata per turn, safely — with mandatory secret redaction on the write path and end-to-end verification against real data.

- [x] **Phase 4: Secret Redaction Scanner** - Vendored regex + entropy scanner that redacts likely secrets in free-text content before it can reach a note (completed 2026-09-17)
- [x] **Phase 5: record-prompt Note-Write Path** - `git turn record-prompt` attaches prompt/model/usage/latency/tool-summary metadata to a turn's note via safe read-merge-write (completed 2026-09-20)
- [ ] **Phase 6: Verification, Redact Command & Purge Procedure** - `--with-prompts`/`cost` proven against real captured data, plus `redact <N>` and a documented purge procedure for already-written secrets

### 📋 v0.4 MCP Server (Phase 7)

- [ ] **Phase 7: MCP server** — Claude Code addon, `git_turn_log`, `git_turn_show`, `git_turn_revert` tools

### 📋 v1.0 Warren Integration (Phase 8)

- [ ] **Phase 8: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Phase Details

### Phase 4: Secret Redaction Scanner

**Goal**: Prompt/response content is scanned for likely secrets and redacted before any of it can be written into a note — this must exist and be validated before any writer (Phase 5) touches real content.
**Depends on**: Phase 03.1 (last shipped phase)
**Requirements**: REDACT-01
**Success Criteria** (what must be TRUE):

  1. The scanner detects known vendor-prefixed secrets (AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe keys, PEM blocks, generic `key=value` assignments) in sample text and replaces each match with a redaction marker.
  2. The scanner also catches high-entropy tokens that have no recognizable vendor prefix, via a Shannon-entropy fallback (base64/hex thresholds), so unstructured secrets aren't missed.
  3. The scanner is validated against realistic fixtures — pasted `.env` blocks, multi-line PEM keys, paraphrased secrets embedded in prose, low-entropy short secrets — with documented false-negative behavior, not just vendor-pattern happy-path cases.
  4. The scanner runs unconditionally with no bypass/opt-out flag, ready to be called from any note-write path.

**Plans**: 1 plan

Plans:

- [x] 04-01-PLAN.md — `src/redact.js` scanner (9 vendor regex patterns, whitelist-gated Shannon-entropy fallback) + `src/redact.test.js` fixture suite with documented false negatives and proven security properties

### Phase 5: record-prompt Note-Write Path

**Goal**: `git turn record-prompt` lets a user attach prompt/model/latency/usage/tool-summary metadata to the current turn's note, safely and without clobbering what the post-commit hook already wrote.
**Depends on**: Phase 4
**Requirements**: CAPTURE-01, CAPTURE-02, CAPTURE-03, CAPTURE-04
**Success Criteria** (what must be TRUE):

  1. Running `git turn record-prompt` after a turn adds prompt/model/usage fields to that turn's note while `session_id`/`turn_n`/`snapshot_sha`/`ts` (written by the hook) remain intact — target turn resolved via `listTurns()`/`parseSnapshotMessage()`, never bare `HEAD`, via a read-merge-write helper with retry-on-conflict.
  2. Any prompt/response content passed to `record-prompt` is redacted through Phase 4's scanner before the note is written — no secret ever lands in `refs/notes/git-turn`.
  3. `usage` is written in the exact Anthropic-shape schema (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`).
  4. When the caller supplies start/stop timestamps to `record-prompt`, `latency_ms` is captured on the note.
  5. A tool-call count/name summary can be attached to the note alongside prompt metadata.

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — `updateNote()` read-merge-write helper in `src/git.js` + `src/git.test.js` (merge preservation, race retry, retry exhaustion)
- [x] 05-02-PLAN.md — `src/cache.js` guarded `usage`/`tool_summary` migration, extended `upsertTurn()`, new `updatePromptFields()` + `src/cache.test.js`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-03-PLAN.md — `src/commands/record-prompt.js` (stdin JSON, redaction, turn-index targeting, merge write, best-effort cache) + tests, `bin/git-turn` registration, AGENTS.md refresh

### Phase 6: Verification, Redact Command & Purge Procedure

**Goal**: Captured prompt/model/usage data renders and prices correctly end-to-end through the already-shipped read side, and there's a real remediation path for a secret that made it into a note anyway.
**Depends on**: Phase 5
**Requirements**: REDACT-02, REDACT-03, VERIFY-01, VERIFY-02
**Success Criteria** (what must be TRUE):

  1. `git turn log --with-prompts` and `git turn show --with-prompts` render real captured prompt/model/latency data end-to-end (against a real repo with a real `record-prompt` note, not just isolated unit fixtures).
  2. `git turn cost` computes correct dollar costs from real captured `usage` data end-to-end.
  3. A user can run `git turn redact <N>` to manually scrub a specific turn's note content after the fact.
  4. A documented purge procedure (reflog-expire + `gc --prune=now` scoped to `refs/notes/git-turn`) exists and is verified to actually remove an old note blob, since neither `git filter-repo` nor BFG cover this ref namespace.

**Plans**: 4 plans

Plans:
**Wave 1**

- [ ] 06-01-PLAN.md — VERIFY-01: fix the note-sha resolution bug in `show.js` and `log.js`'s `--no-cache` walk, add `show.js`'s `--with-prompts` gate, new `show.test.js` + `log.test.js` end-to-end coverage
- [ ] 06-02-PLAN.md — VERIFY-02: fix the same note-sha bug in `cost.js`, new `cost.test.js` with a network-free `HOME`-scoped pricing fixture proving a correct `$0.0105` total
- [ ] 06-03-PLAN.md — REDACT-02: new `src/commands/redact.js` (prompt-only scrub via `updateNote`, no confirmation, cache sync) + `redact.test.js` + `bin/git-turn` registration

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 06-04-PLAN.md — REDACT-03: `purgeNotesHistory()` in `src/git.js` (history-collapse → reflog-expire → prune), `gc --purge-notes` dispatch with blast-radius warning, object-store-level tests, README/AGENTS documentation

### Phase 7: MCP server

**Goal**: Claude Code can drive git-turn via an MCP addon exposing `git_turn_log`, `git_turn_show`, `git_turn_revert` tools.
**Depends on**: Phase 6
**Requirements**: TBD (scoped at v0.4 planning)
**Success Criteria** (what must be TRUE):

  1. TBD — scoped at v0.4 planning.

**Plans**: Not yet planned.

### Phase 8: Warren integration

**Goal**: `git turn branch --from <N>` creates a warren workspace branched from a specific turn.
**Depends on**: Phase 7, Warren API availability
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
| 6. Verification, redact command & purge procedure | v0.3 | 0/4 | Planned | — |
| 7. MCP server | v0.4 | 0/? | Planned | — |
| 8. Warren integration | v1.0 | 0/? | Planned | — |

Also shipped ad hoc, untracked by any phase (same pattern as Phase 2's SQLite cache): `session new`/`session list` (fork lineage) and `export` (cross-repo ref bundle) — commit `7b446ce`, 2026-09-06.

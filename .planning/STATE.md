---
gsd_state_version: 1.0
milestone: v0.4
milestone_name: MCP Server
status: Roadmap created
stopped_at: Phase 7 context gathered
last_updated: "2026-10-07T23:36:06.356Z"
last_activity: 2026-10-07 — v0.4 roadmap created (Phases 7-10), Warren integration renumbered to Phase 11
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-07)

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.
**Current focus:** Roadmap approved for v0.4 MCP Server (Phases 7-10); ready for `/gsd-plan-phase 7`

## Current Position

Phase: 7 (Compute/Run Split & CLI JSON Output) — not yet planned
Plan: —
Status: Roadmap created
Last activity: 2026-10-07 — v0.4 roadmap created (Phases 7-10), Warren integration renumbered to Phase 11

## Performance Metrics

**Velocity:**

- Total plans completed: 8 (prior milestones; 0 this milestone)
- Average duration: n/a
- Total execution time: n/a

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 4 | 1 | - | - |
| 5 | 3 | - | - |
| 6 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: n/a
- Trend: n/a

*Updated after each plan completion*

## Decisions

- Forensics-first framing (audit tool, not undo button)
- Dangling commit-tree snapshots (two trees: index + worktree)
- jj-style op log in .git/git-turn/ops/
- No shell interpolation — execFile only
- Separate repo from warren
- [v0.3 roadmap]: "Reuse warren's secret pattern list" retired — warren has no content-based secret detector; Phase 4 builds a new vendored regex + entropy scanner instead
- [v0.3 roadmap]: Cache schema migration (`usage` column) folded into Phase 5 as an implementation prerequisite rather than a standalone roadmap phase — no independent user-observable behavior of its own
- [v0.3 roadmap]: `redact <N>` and the purge procedure (REDACT-02/03) grouped with verification (Phase 6) rather than with the scanner (Phase 4), since both are post-hoc remediation for the write path Phase 5 delivers
- [v0.3 roadmap]: MCP server moved out of v0.3 (per PROJECT.md, deferred) — renumbered as v0.4 Phase 7; Warren integration shifted to Phase 8
- [v0.4 roadmap]: MCP server milestone expanded from the single placeholder Phase 7 into 4 phases (7-10), following research's build-order sequencing: compute/run split -> server scaffold -> register tools -> E2E verification with a real client. Warren integration renumbered Phase 8 -> Phase 11.
- [v0.4 roadmap]: `--json` (JSON-01) folded into Phase 7 rather than given its own phase — it touches the same 5 command files as the compute/run split and has no dependency on the MCP scaffold.
- [v0.4 roadmap]: VERIFY-03 (live round-trip note test) grouped into Phase 9 (tool registration) rather than Phase 10, since it specifically guards the per-tool sha-resolution logic being written in that phase; VERIFY-04 (real client E2E) is the dedicated Phase 10.
- [v0.4 roadmap]: `git_turn_revert`/`bisect`/`redact`/`record-prompt` are not phases this milestone — explicitly deferred (no MCP confirmation/elicitation pattern exists yet); tracked in REQUIREMENTS.md Future Requirements, not a roadmap placeholder.
- [Phase 7 discuss]: Folded the pending rich-diff-renderer todo (2026-09-07) into Phase 7 as new requirement DIFF-01, per explicit user direction, since it touches the same `diff.js`/`show.js` files already being refactored. Resolved the conflict with REFACTOR-01's "byte-identical" acceptance bar by making the rich renderer the new default and adding `--plain` to restore exact current output — REFACTOR-01's acceptance criterion is now verified against the `--plain` path, not the unflagged default. The stable-change-identity todo (score 0.2) was reviewed but not folded — unrelated to this phase's scope.

## Pending Todos

- `2026-09-06-secret-redaction-on-notes.md` [security] — now scoped across Phase 4 (scanner) + Phase 6 (redact/purge), not a single locked requirement on one phase
- `2026-09-07-rich-diff-renderer.md` [cli] — optional enhancement over shipped color-diff
- `2026-09-17-mindwalk-integration.md` [integration] — explore turn-boundary markers for mindwalk's session replay via a preprocessing script, not a fork
- `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` [research] — inspired by Delta/DeltaDB's stable change-identity model; explore content-hash/diff-anchor fallback for blame/show/redact robustness to history rewrites, no multiplayer/cloud/new-VCS scope

## Blockers/Concerns

- Cross-process race window between the post-commit hook and `record-prompt` (Phase 5) has no existing lock primitive — flagged in research for deeper investigation during `/gsd-plan-phase 5`.
- Secret-scanner false-negative behavior against freeform conversational text is reasoned, not empirically validated — Phase 4 planning should budget for building a realistic fixture set, not just vendor-pattern unit tests.
- `server.connect(transport)`'s promise-resolution timing (does it resolve only on stdio close, or right after handshake) is MEDIUM confidence per research and must be verified empirically during Phase 8 planning/execution before Phase 9's tools depend on it.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| uat | 03-UAT.md (Phase 03) | resolved, 0 pending scenarios | v0.2 close |
| feature | MCP server | in progress, v0.4 Phases 7-10 | v0.3 roadmap creation, 2026-09-17 |
| feature | Warren integration | planned, moved to v1.0 (Phase 11) | v0.4 roadmap creation, 2026-10-07 |
| feature | `git_turn_revert`/`bisect`/`redact`/`record-prompt` as MCP tools | deferred, blocked on MCP confirmation/elicitation pattern | v0.4 requirements definition, 2026-10-07 |
| todo | 2026-09-07-rich-diff-renderer.md [cli] | acknowledged, deferred | v0.3 close, 2026-10-01 |
| todo | 2026-09-17-mindwalk-integration.md [integration] | acknowledged, deferred | v0.3 close, 2026-10-01 |

## Session Continuity

Last session: 2026-10-07T23:36:06.304Z
Stopped at: Phase 7 context gathered
Resume file: .planning/phases/07-compute-run-split-cli-json-output/07-CONTEXT.md

## Operator Next Steps

- Review and approve the v0.4 roadmap, then run `/gsd-plan-phase 7`

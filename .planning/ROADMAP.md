# Roadmap: git-turn

**Milestone:** v0.1 Working CLI
**Started:** 2026-08-09
**Granularity:** standard

## Overview

git-turn ships as a git extension. v0.1 delivers the core audit loop: init, turn capture via post-commit hook, and the read commands (log, show, diff, blame, bisect). SQLite read cache makes log/blame fast at scale.

## Phases

- [ ] **Phase 1: Core commands** — init, log, show, diff, revert, redo, status, gc (scaffold exists, needs tests + remaining commands)
- [ ] **Phase 2: SQLite read cache** — fast log/blame/bisect without walking git objects; rebuild from notes on startup
- [ ] **Phase 3: bisect + blame** — `git turn bisect <cmd>`, `git turn blame <file>`
- [ ] **Phase 4: Prompt capture** — `git turn record-prompt`, note storage, `--with-prompts` flag on log/show
- [ ] **Phase 5: MCP server** — Claude Code addon, `git_turn_log`, `git_turn_show`, `git_turn_revert` tools
- [ ] **Phase 6: Warren integration** — `git turn branch --from N` → `POST /workspaces/{id}/branch`

## Progress

| Phase | Status |
|-------|--------|
| 1. Core commands | In Progress |
| 2. SQLite read cache | Planned |
| 3. bisect + blame | Planned |
| 4. Prompt capture | Planned |
| 5. MCP server | Planned |
| 6. Warren integration | Planned |

## Phase 1 Detail

**Goal:** Complete the v0.1 CLI surface — all 8 commands working end-to-end with a full test suite.

**Requirements:** D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12

**Plans:** 4/6 plans executed

Plans:
- [x] 01-01-PLAN.md — Foundation: fix test script + test-repo helper + diff command (D-04, D-05, D-12)
- [x] 01-02-PLAN.md — Read commands: status + init format blob (D-06, D-07, D-11)
- [x] 01-03-PLAN.md — Mutation pair: revert + redo commands (D-01, D-02, D-03)
- [x] 01-04-PLAN.md — GC command (D-08, D-09, D-10)
- [ ] 01-05-PLAN.md — Tests for diff, status, init (D-04, D-05, D-06, D-07, D-11, D-12)
- [ ] 01-06-PLAN.md — Tests for revert, redo, gc (D-01, D-02, D-03, D-08, D-09, D-10, D-12)

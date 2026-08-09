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

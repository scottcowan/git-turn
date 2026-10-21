---
phase: 08-mcp-server-scaffold
plan: 02
subsystem: infra
tags: [mcp, npm, zod, dependencies, supply-chain]

requires:
  - phase: 08-mcp-server-scaffold (plan 01, 03)
    provides: no direct code dependency — 08-01 (cost.js) and 08-03 (mcp.js) are independent of this plan's package.json change at the file level, but 08-03 imports the packages this plan installs
provides:
  - "@modelcontextprotocol/server@2.3.1 and zod@4.6.5 as git-turn's first-ever runtime dependencies"
  - "human-verified supply-chain legitimacy check before install (T-08-SC)"
affects: [08-mcp-server-scaffold plan 03, phase 09 mcp tool registration]

tech-stack:
  added: ["@modelcontextprotocol/server@2.3.1", "zod@4.6.5"]
  patterns: ["blocking-human checkpoint before adding a first-ever runtime dependency"]

key-files:
  created: [package-lock.json]
  modified: [package.json]

key-decisions:
  - "Exact pins (--save-exact, no caret) for both packages per RESEARCH.md's fast-moving-dependency guidance"
  - "No `type: module` added — package's dual CJS/ESM exports map lets existing CommonJS require() work unchanged"

patterns-established:
  - "Supply-chain legitimacy check (npm view + human npmjs.com confirmation) before any first-time dependency addition"

requirements-completed: [MCP-01]

duration: 12min
completed: 2026-10-21
---

# Phase 08: MCP Server Scaffold — Plan 02 Summary

**Added @modelcontextprotocol/server@2.3.1 and zod@4.6.5 as git-turn's first-ever runtime dependencies, gated behind a blocking human legitimacy check**

## Performance

- **Duration:** ~12 min (across checkpoint wait + install)
- **Started:** 2026-10-21T16:47Z
- **Completed:** 2026-10-21T17:10Z
- **Tasks:** 2
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments
- Ran read-only `npm view` registry checks on all three packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `zod`) and presented them to the user before any install
- User explicitly approved after reviewing registry evidence (repo/org match, no typosquat, no install-time lifecycle scripts)
- Installed both packages pinned exact via `npm install --save-exact`
- Verified `require('@modelcontextprotocol/server').McpServer`, `require('@modelcontextprotocol/server/stdio').serveStdio`, and `require('zod/v4').object` all resolve correctly from git-turn's CommonJS code with no build step
- Full existing test suite (286/286) still green after the dependency addition

## Task Commits

1. **Task 1: Human verifies package legitimacy before install** — no commit (read-only checkpoint, no files modified)
2. **Task 2: Install and pin the dependencies** - `576ef7f` (feat)

## Files Created/Modified
- `package.json` - added `dependencies` block with `@modelcontextprotocol/server: 2.3.1` and `zod: 4.6.5`, no other fields touched
- `package-lock.json` - new file, integrity hashes for the 3-package dependency tree (`@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `zod`)

## Decisions Made
- Exact pins chosen over caret ranges, per RESEARCH.md's note that this dependency family moves fast (spec was dated 2026-07-28) and reproducible installs matter more than auto-picking up patches
- Confirmed no additional top-level packages appeared beyond the three expected (`@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `zod`) — `npm ls --depth=0` shows exactly 2 direct deps, `ls node_modules` shows exactly 2 top-level dirs

## Deviations from Plan

None — plan executed exactly as written. One process note: this plan's Task 2 was executed by the orchestrator directly in the existing worktree (not a freshly-spawned `isolation="worktree"` agent) after the checkpoint was approved, since `isolation="worktree"` always creates a *new* worktree and cannot resume an in-progress one — an established pattern from earlier in this project's history.

## Issues Encountered
- The worktree this plan's first attempt landed in was initially pinned to a stale base commit (`d591cff`, back at v0.1) rather than the expected `bc1bf1a`. The executor's own worktree-branch-check step detected the mismatch and self-corrected via `git reset --hard` before reading the plan — confirmed correct base (`bc1bf1a`) before any file was touched. (This same stale-base issue affected the sibling plan 08-01 in the same wave; unrelated to this plan's content.)

## Next Phase Readiness
- Plan 08-03 (`git turn mcp` scaffold) can now `require('@modelcontextprotocol/server')` and `require('zod/v4')` directly
- No blockers

---
*Phase: 08-mcp-server-scaffold*
*Completed: 2026-10-21*

# Phase 3: bisect + blame - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `git turn blame <file>` and `git turn bisect <cmd>` — the two commands still listed as "not yet implemented" in `bin/git-turn`. Both read from the SQLite cache built in Phase 2 (`src/cache.js`) where possible, falling back to `refs/notes/git-turn` if the cache is missing.

</domain>

<decisions>
## Implementation Decisions

### Blame granularity and scope
- **D-01:** `git turn blame <file>` is per-line (git-blame style), not per-file. Output must show which turn last touched each line — walk each turn's diff hunks in order to build a line→turn map, tracking line-number shifts across turns (insertions/deletions change downstream line numbers).
- **D-02:** Blame scope is all sessions — the full git-turn history for that file, not just the current session. Must enumerate turns across all `refs/git-turn/sessions/*/turn-*`, ordered by time (or by session start + turn_n), not scoped to `readSession()`'s current session like `log`/`show`/`diff` are.

### Bisect worktree safety
- **D-03:** `git turn bisect <cmd>` requires a clean worktree to start — refuse with an error if there are uncommitted changes (matches `git bisect`'s own precondition; avoids losing work when swapping in candidate snapshots).
- **D-04:** Snapshot current state before starting (reuse the `snapshotWorktree()` + pre-op-snapshot pattern from `revert.js`). Always call `restoreSnapshot()` back to the pre-bisect state when the search finishes — on success, on failure to find a bad turn, and on any error/interrupt path. No candidate snapshot should be left checked out after the command exits.

### Bisect reporting
- **D-05:** Print live progress while narrowing candidates — for each candidate turn, print which turn is being tested and whether `<cmd>` passed or failed (mirrors `git bisect`'s running commentary), then the final "turn N introduced the failure" line.

### Claude's Discretion
- Exact line-shift tracking algorithm for per-line blame (e.g., diff hunk header parsing vs a full three-way line-tracking structure) — implementation detail, not a user-facing decision.
- Exact bisect search order (bisect by turn index within the full cross-session ordering) and how `<cmd>`'s exit code maps to good/bad (0 = good, nonzero = bad, matching `git bisect run` convention) unless research surfaces a reason to deviate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing implementation (read before adding either command)
- `src/cache.js` — SQLite read cache; `getTurnsForFile(filePath)` already returns per-file touch history (file-level, not line-level) — the file-level lookup blame builds on top of; `getTurns(sessionId)` and `rebuild()` show the cross-session ref-walking pattern bisect/blame both need
- `src/git.js` — `snapshotWorktree`, `restoreSnapshot`, `gitSafe`, `listRefs` — no shell interpolation rule enforced here
- `src/session.js` — `NOTES_REF`, `listTurns(sessionId)`, `readSession()`, `writeOp`/`readOps` — current-session-scoped; bisect/blame need a cross-session variant
- `src/commands/revert.js` — reference pattern for "snapshot current state, restore to target, write an op so the operation can be undone/tracked" — bisect should mirror the pre-op-snapshot + guaranteed-restore structure
- `bin/git-turn` — dispatcher; `blame` and `bisect` are already declared in `COMMANDS` and routed to `src/commands/blame.js` / `src/commands/bisect.js` once those files exist

### Project decisions
- `.planning/PROJECT.md` — storage model, key decisions, prior art
- `AGENTS.md` — currently documents blame/bisect as "not yet implemented"; must be updated once shipped (see Success Criteria in ROADMAP.md Phase 3)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getTurnsForFile(filePath)` in `src/cache.js` — file-level touch list already built; blame's per-line map is a refinement on top of this, not a replacement
- `rebuild()` in `src/cache.js` — shows how to walk `refs/git-turn/sessions/` across ALL sessions and order by turn — exactly the cross-session enumeration blame/bisect need (current per-command `readSession()` scoping does not apply here)
- `snapshotWorktree()` / `restoreSnapshot(sha, { branch })` in `src/git.js` — ready to reuse for bisect's checkout-candidate / restore-original cycle

### Established Patterns
- Every command: `module.exports = { run(args) }` — `args` is the argv slice after the command name
- All git ops go through `execFileSync('git', args[])` — never string concat
- Non-fatal git calls use `gitSafe()`
- Notes ref: `NOTES_REF = 'refs/notes/git-turn'` (imported from `session.js`)

### Integration Points
- `bin/git-turn` already declares `blame` and `bisect` in `COMMANDS` and will dispatch to `src/commands/blame.js` / `src/commands/bisect.js` as soon as those files exist — no dispatcher changes needed
- Cache schema (`turns`, `turn_files`) already has everything blame needs at file granularity; line granularity requires walking `git diff` hunks between consecutive snapshot shas per file, which is new work not present in Phase 2

</code_context>

<specifics>
## Specific Ideas

No specific UI/output-format references beyond "git-blame style" for blame and "git bisect's running commentary" for bisect — both are existing, well-understood conventions the user wants mirrored.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)
- `2026-08-19-rename-checkpoints-to-rewind-points.md` — matched Phase 3 on generic keyword overlap ("git, turn, commands, readme") but is a `log`/`show`/README terminology change unrelated to blame/bisect. Not folded; remains a standalone todo for whichever phase touches `log.js`/`show.js` output next.
- `sqlite-read-cache.md` — already shipped ad hoc in commit `d591cff` (2026-08-18), tracked retroactively as Phase 2 in `ROADMAP.md`. Not folded; noted here so it isn't picked up again by a future phase's todo matcher.

</deferred>

---

*Phase: 3-bisect-blame*
*Context gathered: 2026-09-02*

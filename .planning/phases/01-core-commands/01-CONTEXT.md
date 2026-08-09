# Phase 1: Core commands - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the 5 missing commands (`diff`, `revert`, `redo`, `status`, `gc`) and a test suite. The scaffold already ships `init`, `log`, `show`, and the post-commit hook. Phase 1 completes the v0.1 CLI surface so the tool is usable end-to-end.

Also: at `git turn init`, write a machine-readable format discovery blob to a ref so external tools (e.g. Warren) can detect git-turn without parsing session files:

```sh
BLOB=$(echo '{"version":"1","tool":"git-turn",...}' | git hash-object -w --stdin)
git update-ref refs/turns/.format $BLOB
```

</domain>

<decisions>
## Implementation Decisions

### revert / redo semantics
- **D-01:** `git turn revert <N>` restores worktree + index only. HEAD commit stays where it is. Uses `restoreSnapshot()` from `src/git.js` which already handles this.
- **D-02:** `git turn redo` undoes the last revert only (LIFO). No full op-log traversal needed in this phase.
- **D-03:** Cross-branch revert is a hard fail. `restoreSnapshot()` already throws on branch mismatch — let it propagate to the user as an error.

### diff command scope
- **D-04:** `git turn diff N M` diffs the snapshot worktree-trees of turn N and turn M (not HEAD commits). Preserves visibility into untracked files.
- **D-05:** `git turn diff N` (single arg) diffs turn N-1 vs turn N — consistent with `git turn show N` semantics.

### status output
- **D-06:** `git turn status` shows session summary only: session ID, current turn count, branch, hook installed/missing, session started time. No pending-changes diff.
- **D-07:** Hook health = file presence check only. `.git/hooks/post-commit` exists and contains `git-turn`. No test-fire invocation.

### gc retention
- **D-08:** Default retention is last 10 sessions. Configurable via `--keep-sessions N`.
- **D-09:** GC deletes refs only (`refs/git-turn/sessions/{id}/turn-*` for pruned sessions). Dangling snapshot commits become eligible for git's own GC.
- **D-10:** After pruning, print: `Snapshot objects will be reclaimed on next 'git gc'`.

### Format discovery blob (init)
- **D-11:** At `git turn init`, write a JSON blob to `refs/turns/.format` via `git hash-object -w --stdin` + `git update-ref`. Schema TBD in implementation but must include `version` and `tool` fields. Warren reads this; git-turn writes it. The two repos stay decoupled.

### Tests
- **D-12:** Test suite needed for all commands. Node's built-in `--test` runner is already in `package.json`. Tests live in `src/**/*.test.js` (glob already in the test script).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing implementation (read before adding any command)
- `src/git.js` — all git helpers; `snapshotWorktree`, `restoreSnapshot`, `listRefs`, `addNote/getNote`. No shell interpolation rule enforced here.
- `src/session.js` — session CRUD, op log, `listTurns`, `turnRef`, `writeOp`/`readOps`
- `src/hooks/post-commit.js` — serialized checkpoint pattern (pending-promise chain)
- `src/commands/init.js` — command module shape (`module.exports = { run(args) }`)
- `src/commands/log.js` — example of reading session + turns + notes
- `src/commands/show.js` — example of single-turn snapshot diff
- `bin/git-turn` — dispatcher; full command list already declared

### Project decisions
- `.planning/PROJECT.md` — storage model, key decisions, prior art

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `snapshotWorktree()` in `src/git.js` — used by post-commit; `diff` and `show` can reuse the same snapshot shas stored via refs
- `restoreSnapshot(snapshotSha, { branch })` in `src/git.js` — ready to use for `revert`; already enforces branch check
- `listTurns(sessionId)` in `src/session.js` — returns sorted `[{turn_n, ref, sha}]`; used by `log` and `show`; `diff`, `revert`, `status` all need it
- `writeOp` / `readOps` in `src/session.js` — op log for redo state
- `gitSafe()` in `src/git.js` — null-returning wrapper; use for non-fatal git calls

### Established Patterns
- Every command: `module.exports = { run(args) }` — `args` is the argv slice after the command name
- All git ops go through `execFileSync('git', args[])` — never string concat
- Session guard at top of every read command: `readSession()` → exit 1 if null
- Notes ref: `NOTES_REF = 'refs/notes/git-turn'` (imported from `session.js`)

### Integration Points
- `bin/git-turn` dispatches to `src/commands/${cmd}.js` — new commands just need a file there
- `git turn redo` needs to read the op log to find the last `before-turn` entry written by a revert op — `revert` must write its own op so `redo` can restore from it

</code_context>

<specifics>
## Specific Ideas

- Format blob at init: `refs/turns/.format` containing `{"version":"1","tool":"git-turn",...}` — exact schema to be defined during planning but Warren discovery is the use case.

</specifics>

<deferred>
## Deferred Ideas

- `blame`, `bisect`, `branch`, `session` commands — Phase 3 / Phase 6
- SQLite read cache for fast log/blame — Phase 2
- Prompt capture (`--with-prompts` already scaffolded in `log.js`) — Phase 4

</deferred>

---

*Phase: 1-Core commands*
*Context gathered: 2026-08-09*

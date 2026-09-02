# Phase 3: bisect + blame - Research

**Researched:** 2026-09-02
**Domain:** Git internals (blame/diff/bisect semantics), Node.js child_process, node:sqlite read-cache queries
**Confidence:** HIGH (codebase-grounded), MEDIUM (git-bisect exit-code convention, verified against well-known git docs pattern but not re-fetched live)

## Summary

Both commands build directly on Phase 2's cache and Phase 1's snapshot/session primitives — no new external dependencies are needed. The single most important finding, discovered by reading `src/hooks/post-commit.js` and `src/git.js` rather than assumed from git-blame folklore, is that **every turn snapshot's parent is the real HEAD commit at that point, not the previous turn's snapshot**. That means turn boundaries already coincide 1:1 with real git commits (`turns.head_sha` in the cache). This is a structural fact, not a design choice, and it changes the recommended blame architecture: for any file that is actually tracked in git (the common case), real `git blame` run against the live commit graph is correct, handles renames/line-shift natively, and is far simpler than hand-rolling a forward-diff annotator. The hand-rolled forward-diff-hunk approach is only needed as a fallback for content that was captured in a snapshot's worktree tree but never `git add`/committed (untracked files) — those have no real commit history for `git blame` to walk.

For bisect, the codebase already has every primitive needed (`snapshotWorktree`, `restoreSnapshot`, `writeOp`, the revert.js pre-op-snapshot pattern) except two things: a cross-session turn enumeration (current `listTurns`/`readSession` are session-scoped) and a way to run an arbitrary user-supplied shell command safely. The "no shell interpolation" rule in this codebase applies to *git* invocations (`execFileSync('git', args[])`) — it does not and cannot apply to the bisect `<cmd>` argument, which is inherently a shell command the user wants executed verbatim (matching `git bisect run`'s own behavior of invoking the command through the shell).

**Primary recommendation:** Implement blame as "real `git blame` + head_sha→turn lookup, with hand-rolled hunk-diff fallback for untracked-only files"; implement bisect as a classic binary search over a cross-session, topologically-ordered turn list, running the candidate command via `spawnSync(cmd, { shell: true })`, honoring the `git bisect run` exit-code convention (0=good, 125=skip, other nonzero=bad, ≥128=abort), and wrapping the whole search in the revert.js pre-op-snapshot/guaranteed-restore pattern.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-line attribution (blame) | Git object store (via `git blame`) | SQLite cache (head_sha→turn lookup) | Git already solves line-history correctly; cache only maps commit→turn identity |
| Turn ordering (cross-session) | SQLite cache (`turns` table) | Git ref/commit graph (topo-order fallback/verification) | Cache is the fast path; git graph is ground truth when cache is stale/absent |
| Candidate checkout (bisect) | `src/git.js` (`snapshotWorktree`/`restoreSnapshot`) | — | Already built in Phase 1, reused verbatim |
| Arbitrary `<cmd>` execution (bisect) | Node `child_process` (new, in `src/commands/bisect.js`) | — | No existing shell-command-execution primitive in codebase; must be added |
| Untracked-file line attribution (blame fallback) | Hand-rolled hunk parser (new, in `src/commands/blame.js` or a shared `src/blame-util.js`) | `turn_files` cache table (existence check only) | Git has no commit history for untracked content — nothing else can supply this |
| Op logging (bisect start/end) | `src/session.js` (`writeOp`) | — | Matches revert.js's audit-trail pattern |

## Standard Stack

No new external packages are required for this phase. Everything needed is either already in the codebase or a Node.js/git built-in.

### Core (already present, reused as-is)
| Module/Binary | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:sqlite` (`DatabaseSync`) | Node 22+ built-in | Read cache queries for turn/turn_files lookups | [VERIFIED: codebase] Already used throughout `src/cache.js` |
| `git blame --porcelain` | Git 2.x (any) | Per-line commit attribution for tracked files | [CITED: git-blame(1)] Canonical tool for exactly this problem — do not reimplement |
| `git diff --unified=0` | Git 2.x (any) | Hunk-level diff for the untracked-file fallback path | [CITED: git-diff(1)] `-U0` minimizes context noise, gives exact changed-line ranges |
| `child_process.spawnSync` | Node built-in | Running the bisect `<cmd>` and capturing its exit code | [VERIFIED: codebase] Already imported in `src/commands/init.js` for `git hash-object` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `git merge-base --is-ancestor` | Git 2.x | Validate that a turn's `head_sha` is actually reachable from current HEAD before treating it as a bisect candidate | Guards against cross-session turns that live on a divergent/deleted branch |
| `git rev-list --topo-order` | Git 2.x | Ground-truth ordering of `head_sha`s when reconciling cross-session turn order (see Open Questions) | Fallback/cross-check against cache `ts` field, or if cache is stale |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real `git blame` + head_sha map | Full hand-rolled forward-diff annotator for ALL files (tracked + untracked) | Handles the untracked edge case uniformly, but reimplements rename detection, copy detection, and line-shift math that git already solves correctly — high risk of subtle attribution bugs; git's implementation is decades-refined |
| `spawnSync(cmd, {shell:true})` for bisect's `<cmd>` | Force user to pass an array (`execFileSync(cmd, argsArray)`, no shell) | Safer against injection in the abstract, but breaks the documented UX (`git turn bisect "npm test -- --grep foo"` as one shell string, matching `git bisect run <cmd>`) and diverges from the locked convention this phase mirrors |
| Cache-first cross-session ordering by `ts` string | `git rev-list --topo-order` as primary ordering key | `ts` is simpler and already stored, but is client wall-clock (subject to clock skew/duplicate timestamps within the same ms on fast test loops); topo-order is ground truth but requires a git call per bisect run — recommend topo-order as the *authoritative* order, `ts` as a cheap tie-breaker/sort key when topo data is unavailable (see Open Questions) |

**Installation:**
No installation step — nothing new to add to `package.json`. `engines.node: ">=22"` (already set) covers `node:sqlite`.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new external packages. `package.json` has no `dependencies` block today and this phase should not add one.

## Architecture Patterns

### System Architecture Diagram — blame

```
git turn blame <file>
        │
        ▼
 [1] resolve cross-session turn list ordered oldest→newest
        │  (SQLite cache `turns` table, ALL sessions — new query;
        │   fallback: walk refs/git-turn/sessions/*/turn-* like rebuild() does)
        ▼
 [2] is <file> tracked in real git history? ──(git ls-files / git log --follow -- <file>)
        │
        ├─ YES ──► [3a] `git blame --porcelain -- <file>` against current HEAD
        │              │
        │              ▼
        │          [4a] for each blamed line: commit SHA → look up in
        │               head_sha→{session_id,turn_n} index built from [1]
        │               │
        │               ├─ match found  → attribute line to that turn
        │               └─ no match     → attribute to "pre-git-turn / external commit <sha>"
        │
        └─ NO (untracked-only) ──► [3b] hand-rolled forward annotation:
                       walk turns oldest→newest, `git diff --unified=0 prevSnapshotSha snapshotSha -- <file>`,
                       parse hunk headers, update line→turn map + shift downstream line numbers
        │
        ▼
 [5] print per-line report: line_no | turn (session short-id + turn_n) | content
```

### System Architecture Diagram — bisect

```
git turn bisect <cmd>
        │
        ▼
 [1] precondition: `git status --porcelain` must be empty (D-03) — else abort with error
        │
        ▼
 [2] pre-bisect snapshot (reuse snapshotWorktree, same pattern as revert.js)
        │  writeOp('bisect-start', { pre_bisect_snapshot_sha, cmd, ... })
        ▼
 [3] build ordered candidate list = cross-session turns whose head_sha
     is an ancestor of current HEAD (merge-base --is-ancestor filter)
        │
        ▼
 [4] binary search loop:
        │   pick midpoint candidate → restoreSnapshot(candidate.sha, {branch})
        │   → spawnSync(cmd, {shell:true}) → interpret exit code
        │   → print "turn N: <PASS|FAIL|SKIP>" (D-05 live progress)
        │   → narrow [lo, hi] based on good/bad
        │   → on exit code 125: mark candidate untestable, narrow around it (git-bisect skip semantics)
        │   → on exit code >=128: abort search entirely, jump to [5] with error state
        ▼
 [5] ALWAYS restoreSnapshot(pre_bisect_snapshot_sha) — success, failure, or thrown error (try/finally)
        │  writeOp('bisect-end', { result, ... })
        ▼
 [6] print final report: "turn N introduced the failure" (or "no failing turn found in range")
```

### Recommended Project Structure
```
src/
├── commands/
│   ├── blame.js          # entry point, dispatches tracked vs untracked path
│   └── bisect.js         # entry point, binary search + restore-guarantee
├── blame-util.js         # NEW: cross-session turn enumeration, head_sha→turn index,
│                          #      hunk parser for the untracked-file fallback (shared,
│                          #      testable in isolation from the command's I/O)
├── cache.js              # extend: add getAllTurns() / getTurnsAcrossSessions() query
├── session.js            # extend: add a cross-session equivalent of listTurns()
└── git.js                # no changes required — snapshotWorktree/restoreSnapshot reused as-is
```

### Pattern 1: Cross-session turn enumeration
**What:** A new function (in `cache.js` and/or `session.js`) that returns ALL turns across ALL sessions, ordered consistently — the cache-table equivalent of what `rebuild()` already does when walking `refs/git-turn/sessions/`.
**When to use:** Both blame (D-02) and bisect need this; today only `getTurns(sessionId)` (single-session) exists.
**Example:**
```javascript
// Source: derived from src/cache.js rebuild() pattern (already walks all sessions)
function getAllTurns() {
  const db = ensureCache();
  return db.prepare('SELECT * FROM turns ORDER BY ts, session_id, turn_n').all();
}
```
Fallback path (cache unavailable) mirrors `rebuild()`'s ref-walking exactly:
```javascript
// Source: src/cache.js rebuild(), lines 129-150 (for-each-ref walk + regex parse)
const refOutput = gitSafe(['for-each-ref', '--format=%(refname) %(objectname)',
  '--sort=refname', 'refs/git-turn/sessions/']) || '';
```

### Pattern 2: head_sha → turn reverse index
**What:** Build a `Map<head_sha, {session_id, turn_n}>` once per blame invocation from the cross-session turn list, then look up each `git blame`-reported commit SHA against it.
**When to use:** This is the bridge between real git blame output and turn-granularity reporting — it's what makes "shell out to real git blame" viable instead of hand-rolling.
**Example:**
```javascript
// Source: derived from src/cache.js turns.head_sha column (already stored per turn)
const turns = getAllTurns();
const byHeadSha = new Map(turns.map(t => [t.head_sha, t]));
// git blame --porcelain output gives a commit SHA per line; look it up:
const turn = byHeadSha.get(blamedCommitSha);
```

### Pattern 3: git-bisect-style binary search with guaranteed restore
**What:** Standard binary search over an ordered array, but every branch — success, "no bad turn found", thrown exception, `<cmd>` itself throwing (ENOENT, permission error) — must funnel through a single `finally` that calls `restoreSnapshot` back to the pre-bisect snapshot.
**When to use:** Bisect's core loop.
**Example:**
```javascript
// Source: derived from src/commands/revert.js pre-op-snapshot pattern
const { commitSha: preBisectSha } = snapshotWorktree({ message: 'pre-bisect snapshot' });
try {
  // ... binary search loop, restoreSnapshot(candidate.sha, {branch}) per iteration ...
} finally {
  restoreSnapshot(preBisectSha, { branch: session.branch });
}
```

### Pattern 4: Running the bisect `<cmd>` and classifying its result
**What:** `<cmd>` is a single shell string (e.g. `"npm test"` or `"npm test -- --grep foo"`), matching `git bisect run <cmd>` UX. Must be invoked through a shell, not `execFileSync` with an args array, because the user is passing shell syntax (pipes, flags, `&&`), not a single executable + argv.
**Example:**
```javascript
// Source: Node child_process docs (spawnSync shell option) + git-bisect(1) exit-code convention
const { spawnSync } = require('child_process');
const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: repoRoot() });
const code = result.status;
if (code === 0) { /* good */ }
else if (code === 125) { /* untestable — skip this candidate, like git bisect skip */ }
else if (code === null || code >= 128) { /* abort search — signal death or fatal error */ }
else { /* bad (1-124, 126-127) */ }
```

### Anti-Patterns to Avoid
- **Hand-rolling per-line blame for tracked files:** Reimplementing line-shift tracking for files that are already real git-tracked content throws away git's own (correct, battle-tested) blame engine for no benefit. Only do this for the untracked-only fallback.
- **Trusting `ts` string ordering alone for bisect candidate order:** Client wall-clock timestamps recorded in the post-commit hook (`new Date().toISOString()`) can collide or skew across fast successive commits or system clock adjustments. Prefer real commit ancestry (`git merge-base --is-ancestor`, `git rev-list --topo-order`) as the authoritative order; use `ts` only as a display/tie-breaker.
- **Leaving a candidate snapshot checked out on error:** Any code path that calls `restoreSnapshot(candidate.sha, ...)` inside the loop without a `finally` that restores the pre-bisect state will violate D-04 if `<cmd>` throws or the process is interrupted (Ctrl-C). Wrap the entire search body, not just the happy path.
- **Assuming every turn's `head_sha` is reachable from current HEAD:** Cross-session turns may belong to a branch that was later force-pushed away, rebased, or deleted. Filter candidates through `git merge-base --is-ancestor <head_sha> HEAD` before including them in the bisect range or blame index; unreachable turns should be reported as "orphaned" rather than silently included or silently crashing on `restoreSnapshot`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-line commit attribution for tracked files | A from-scratch diff-hunk-replay annotator that walks every turn's diff forward | `git blame --porcelain -- <file>` (shell out) | Git's blame already handles rename/copy detection, line-shift math, and merge commits correctly; a hand-rolled version reimplements this with high bug risk for a well-solved problem |
| Binary search bookkeeping | A custom recursive bisect implementation with ad-hoc state | Standard iterative binary search over an array of ordered candidates (lo/hi/mid), mirroring `git bisect`'s own algorithm | `git bisect` itself is a plain binary search — no library needed, but keep the loop structure identical to the well-known algorithm rather than inventing a new narrowing strategy |
| Shell command execution with exit-code semantics | A custom process-runner wrapper with its own pass/fail vocabulary | `child_process.spawnSync(cmd, {shell:true})` + the `git bisect run` exit-code convention (0/125/128+) | Node's built-in covers this fully; reusing git's own convention means users can drop in scripts written for `git bisect run` unchanged |

**Key insight:** Both commands are "read the existing history correctly and index it," not "invent a new algorithm." The temptation in this phase is to over-build custom diff/line-tracking machinery when git itself already solves the hard parts — reach for `git blame` and `git merge-base`/`git rev-list` before writing new parsing code.

## Common Pitfalls

### Pitfall 1: Confusing snapshot-commit parentage with turn ordering
**What goes wrong:** Assuming turn snapshots form a linear chain via `commit-tree -p <prevSnapshot>` (like a normal history) and trying to `git log` or `git rev-list` the snapshot refs directly to get turn order.
**Why it happens:** `snapshotWorktree()` in `src/git.js` sets the snapshot commit's parent to `headSha()` — the *real* HEAD at snapshot time — not the previous turn's snapshot SHA. Snapshot commits are siblings hanging off the real history, not a chain of each other.
**How to avoid:** Order turns by `turn_n` within a session (already correct in `listTurns`/cache), and order sessions/turns across sessions by the real commit ancestry of `head_sha` (or by `ts` as a cheaper proxy), never by walking the snapshot-ref DAG itself.
**Warning signs:** `git log <snapshotSha>` unexpectedly shows unrelated repo history instead of a clean turn-by-turn chain.

### Pitfall 2: `git blame` silently omitting or misattributing untracked-only content
**What goes wrong:** Running `git blame` on a file that was captured only via the untracked-file path in `snapshotWorktree()` (never `git add`/committed to the real branch) either errors ("no such path in HEAD") or blames a much older/unrelated commit if a file with that path existed previously and was deleted.
**Why it happens:** `git blame` only knows about the real commit graph; snapshot worktree-trees include untracked files that git's real history has no record of.
**How to avoid:** Before invoking `git blame`, check `git ls-files -- <file>` (or `git log --follow -- <file>` returning non-empty) to confirm the file has real tracked history; if not, use the hand-rolled `turn_files`/diff-hunk fallback path instead.
**Warning signs:** `git blame` exits nonzero, or its output attributes lines to a commit that predates the file's actual introduction in this session.

### Pitfall 3: Bisect leaving the worktree in a candidate state after interruption
**What goes wrong:** If the user Ctrl-C's mid-bisect, or `<cmd>` hangs/crashes the Node process, the worktree can be left checked out to whatever candidate turn was last tested instead of the original pre-bisect state (violating D-04).
**Why it happens:** `restoreSnapshot` calls inside a loop without a `try/finally` (or without a `process.on('SIGINT', ...)` handler) only run on the happy path.
**How to avoid:** Wrap the entire search body in `try { ... } finally { restoreSnapshot(preBisectSha, ...) }`, and additionally register a `SIGINT`/`SIGTERM` handler that performs the same restore before exiting, since Ctrl-C during `spawnSync` (synchronous, blocking) will otherwise terminate the parent process without running the `finally` in some signal-delivery edge cases — verify this empirically in Node 22 during implementation (spawnSync with `stdio:'inherit'` generally does let SIGINT propagate to the child first, and the parent's `finally` still runs once `spawnSync` returns, but a hard SIGKILL or `<cmd>` that reparents/detaches could still escape this — treat as a residual risk to test, not a guaranteed-safe pattern).
**Warning signs:** After a bisect run that was interrupted, `git status` shows unexpected file content instead of the pre-bisect state.

### Pitfall 4: Treating `head_sha` collisions as ambiguous turn attribution
**What goes wrong:** Two turns could theoretically share the same `head_sha` if a commit produced no snapshot-worthy change is recorded twice, or if session bookkeeping is replayed (e.g., a rebuild race). The `head_sha→turn` map would then be ambiguous (last-write-wins in a plain `Map`).
**Why it happens:** `head_sha` is not declared UNIQUE in the `turns` table schema (only `UNIQUE(session_id, turn_n)` is enforced) — see `src/cache.js` schema.
**How to avoid:** When building the reverse index, detect and report head_sha collisions explicitly (e.g., log to stderr in verbose mode) rather than silently picking one; in practice this should be rare (one commit → one turn per the hook), but don't assume it structurally guaranteed by the schema.
**Warning signs:** Blame output that seems to attribute the same line to different turns on repeated runs.

### Pitfall 5: `git diff --unified=0` hunk headers omitting the count when it's 1
**What goes wrong:** Parsing `@@ -a,b +c,d @@` with a regex that requires both numbers in each pair will fail to match `@@ -5 +5 @@` (git omits the `,count` suffix when count is exactly 1).
**Why it happens:** This is standard unified-diff hunk-header formatting behavior, easy to miss when hand-writing the fallback parser.
**How to avoid:** Use a regex that makes the `,count` group optional and defaults it to `1`, e.g. `/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/`.
**Warning signs:** The hand-rolled fallback silently skips single-line hunks or throws on unexpected hunk-header shapes.

## Code Examples

### Cross-session ordering key candidates (for bisect and blame)
```javascript
// Option A — cheap, already-stored (src/cache.js turns.ts column)
const ordered = getAllTurns(); // ORDER BY ts, session_id, turn_n

// Option B — ground truth via real commit ancestry (ref: git-rev-list(1))
// Use when cache is stale/absent, or to validate Option A's ordering before a bisect run
const topoOrder = gitSafe(['rev-list', '--topo-order', '--reverse',
  ...ordered.map(t => t.head_sha).filter(Boolean)]) || '';
```

### merge-base ancestry check before including a turn as a bisect candidate
```javascript
// Source: git-merge-base(1) --is-ancestor flag (exit code 0 = is ancestor, 1 = not)
const { execFileSync } = require('child_process');
function isAncestor(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD']);
    return true;
  } catch { return false; }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — this is greenfield within the project | N/A | — | No prior blame/bisect implementation exists in this codebase to migrate away from |

**Deprecated/outdated:** None applicable — `git blame`, `git diff`, `git merge-base`, `git rev-list`, and the `git bisect run` exit-code convention are all long-stable git plumbing/porcelain with no relevant recent changes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `git bisect run`'s exit-code convention (0=good, 125=skip, ≥128=abort, other nonzero=bad) is the correct convention to mirror, per CONTEXT.md's own framing ("unless research finds a reason to deviate") | Pattern 4, Code Examples | Low — this is extremely well-established git behavior (training-data confidence HIGH, but not re-verified against a live `git-bisect` man page fetch this session); if wrong, only the 125/128 special-casing needs adjustment, not the core 0/nonzero logic |
| A2 | Cross-session bisect should use cross-session ordering (mirroring blame's D-02), rather than staying session-scoped | Summary, Architecture Patterns | Medium — CONTEXT.md explicitly flags this as unlocked/ambiguous; if the planner/user actually wants session-scoped bisect, the candidate-enumeration step (Pattern/Diagram step 3) needs to filter to `session.session_id` instead of all sessions — everything else in the design is unaffected |
| A3 | `spawnSync` with a hard-kill (SIGKILL) or a detached/reparented child process during bisect could escape the `finally`-based restore guarantee | Pitfall 3 | Medium — if true, D-04's "always restore" guarantee has a real (if narrow) gap that needs a signal-handler-based mitigation in addition to try/finally; should be verified empirically during implementation with a manual Ctrl-C test |

## Open Questions

1. **Cross-session ordering key for bisect/blame: `ts` string vs. real commit topology**
   - What we know: The cache already stores `ts` (client wall-clock ISO string, captured in the post-commit hook) and `head_sha` (real commit SHA) per turn. `rebuild()` currently sorts within a session by `turn_n` only; there is no existing cross-session sort implemented anywhere in the codebase today.
   - What's unclear: Whether `ts` alone is reliable enough across sessions (e.g., two sessions on different machines, or a session where turns arrive within the same millisecond during fast automated test loops) — no test in the current suite exercises multi-session ordering.
   - Recommendation: Use real commit ancestry (`git merge-base --is-ancestor` + `git rev-list --topo-order`) as authoritative for bisect (correctness-critical — a wrong candidate order breaks the binary search invariant), and `ts` as a fast display/tie-break sort for blame (where exact order matters less than "did I find the right turn," and a `git blame`-derived commit SHA is the real source of truth anyway via the head_sha reverse index).

2. **What should blame report for lines attributed to commits that predate `git turn init` or come from a human, non-agent commit?**
   - What we know: `git blame`'s reverse-index lookup (Pattern 2) will simply return `undefined` for any blamed commit SHA that isn't in the `head_sha→turn` map — this is expected and will happen for every repo's pre-git-turn history and for any manual human commits interleaved with agent turns.
   - What's unclear: CONTEXT.md doesn't specify exact output formatting for this case (it only locks that blame is per-line and cross-session — not the exact text for "not a turn").
   - Recommendation: Planner should specify a concrete fallback label (e.g., `<sha> (not a git-turn turn)` with the real short SHA and commit subject) rather than silently omitting the line or crashing — this is a plain UX decision, not a technical blocker.

3. **Does the untracked-file fallback path need its own dedicated cache table, or is on-demand hunk parsing at query time acceptable?**
   - What we know: `turn_files` already records file-level change_type/insertions/deletions per turn (no line ranges). CONTEXT.md marks the exact line-tracking algorithm as Claude's discretion.
   - What's unclear: Expected repo size / turn count in practice — if sessions commonly reach hundreds of turns touching the same untracked file, on-demand hunk parsing at every blame invocation could be noticeably slow; if untracked-file blame is rare/small in practice, on-demand parsing is simplest and avoids schema migration.
   - Recommendation: Start with on-demand parsing (no new `turn_line_ranges` table) since it's the simpler build and the fallback path is expected to be rare (most agent-modified files are tracked); revisit with a dedicated table only if real-world usage shows it's a bottleneck. This keeps Phase 3 scoped and avoids a speculative schema change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` CLI | Both commands (blame, diff, merge-base, rev-list, spawnSync target) | ✓ | git installed and used throughout existing codebase | — (hard requirement, already true for the whole project) |
| Node.js `node:sqlite` | Cache-first queries for cross-session turn lists | ✓ | Node 22+ required by `package.json` engines field | Fallback already implemented pattern: ref-walk via `gitSafe(['for-each-ref', ...])` exactly as `rebuild()`/`log.js`/`show.js` do when cache is absent |
| Node.js `child_process.spawnSync` (shell mode) | Bisect's `<cmd>` execution | ✓ | Node built-in, no version constraint beyond the existing 22+ floor | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all required tooling is already a hard dependency of the existing shipped commands.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in, no dependency) |
| Config file | none — invoked via `npm test` → `node --test` (see `package.json` scripts) |
| Quick run command | `node --test src/commands/blame.test.js` / `node --test src/commands/bisect.test.js` |
| Full suite command | `npm test` (runs `node --test`, discovers all `*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01/blame-1 | Per-line blame reports correct turn for a simple single-session multi-turn edit history | unit | `node --test src/commands/blame.test.js` | ❌ Wave 0 |
| D-02/blame-2 | Blame enumerates turns across ALL sessions, not just current | unit | `node --test src/commands/blame.test.js` | ❌ Wave 0 |
| blame-3 | Untracked-only file falls back to hunk-diff annotation correctly | unit | `node --test src/commands/blame.test.js` | ❌ Wave 0 |
| D-03 | Bisect refuses to start with a dirty worktree | unit | `node --test src/commands/bisect.test.js` | ❌ Wave 0 |
| D-04 | Bisect always restores original worktree state (success, no-bad-turn-found, thrown error paths) | unit | `node --test src/commands/bisect.test.js` | ❌ Wave 0 |
| D-05 | Bisect prints live per-candidate progress and a final "turn N introduced the failure" line | unit (stdout capture, mirrors `status.test.js` pattern) | `node --test src/commands/bisect.test.js` | ❌ Wave 0 |
| bisect-exit-codes | 125 (skip) and ≥128 (abort) exit codes are handled per the documented convention | unit | `node --test src/commands/bisect.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant single test file (`node --test src/commands/blame.test.js` or `bisect.test.js`)
- **Per wave merge:** `npm test` (full suite — 23+ existing tests must stay green alongside new ones)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/commands/blame.test.js` — covers per-line attribution, cross-session enumeration, untracked-fallback, and the "not a git-turn turn" case (Open Question 2)
- [ ] `src/commands/bisect.test.js` — covers dirty-worktree refusal, guaranteed restore across success/failure/throw paths, live progress output, and exit-code classification (0/125/128+/other)
- [ ] Test-repo helper (`src/helpers/test-repo.js`) already supports multi-commit repos via its `git()` helper — no new fixture infrastructure needed, but multi-session tests will need to call `newSession()`/`incrementTurn()` more than once within one test repo (pattern not yet exercised by existing tests — first phase to need genuinely cross-session fixtures)
- [ ] No framework install needed — `node:test` is already wired via `npm test`

## Security Domain

> `security_enforcement` not present in `.planning/config.json` — treated as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local CLI tool, no auth boundary |
| V3 Session Management | no | "Session" here means git-turn's own session concept, not a web/auth session |
| V4 Access Control | no | Single local user, operates on their own repo |
| V5 Input Validation | yes | `<file>` and `<cmd>` arguments must be validated before use — see below |
| V6 Cryptography | no | No crypto usage introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via bisect's `<cmd>` argument | Tampering / Elevation of Privilege | **Accepted risk by design** — `<cmd>` is *meant* to be an arbitrary shell command the user supplies (matching `git bisect run <cmd>`), executed via `spawnSync(cmd, {shell:true})`. This is not attacker-controlled input in the normal threat model (the invoking user already has full shell access to their own machine); the existing codebase's "no shell interpolation" rule applies specifically to constructing *git* argv from untrusted data, not to a user-supplied command string that is the entire point of the feature. No mitigation needed beyond documenting this clearly in README/AGENTS.md so users understand `<cmd>` runs with their own shell privileges. |
| Path traversal via `<file>` argument to blame | Tampering | Pass `<file>` straight through to `execFileSync('git', ['blame', ..., '--', file])` using the argv-array form (never shell-concatenated) — git itself will error cleanly on paths outside the repo or that don't exist; no extra sanitization needed beyond the existing "always execFileSync with args array for git calls" project rule, which already applies here |
| Command output injection into cache/DB from `<cmd>` | Tampering (low severity) | Bisect only inspects `<cmd>`'s **exit code**, not its stdout/stderr content for control-flow decisions (per D-05, output is only echoed for live progress, `stdio:'inherit'` or captured-and-printed verbatim) — no parsing of untrusted output as structured data, so no injection surface into the cache DB |

## Sources

### Primary (HIGH confidence — codebase, read directly this session)
- `/Users/scowan/Projects/scottcowan/git-turn/src/cache.js` — schema, `getTurnsForFile`, `rebuild()` cross-session ref-walk pattern
- `/Users/scowan/Projects/scottcowan/git-turn/src/git.js` — `snapshotWorktree` (parent = real HEAD, not prior snapshot), `restoreSnapshot`, `gitSafe`
- `/Users/scowan/Projects/scottcowan/git-turn/src/session.js` — `listTurns` (session-scoped only), `NOTES_REF`, `turnRef`
- `/Users/scowan/Projects/scottcowan/git-turn/src/hooks/post-commit.js` — confirms 1 commit = 1 turn, `head_sha`/`ts` captured at commit time
- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/revert.js` and `revert.test.js` — pre-op-snapshot + guaranteed-restore reference pattern, branch-mismatch error convention
- `/Users/scowan/Projects/scottcowan/git-turn/bin/git-turn` — dispatcher already wires `blame`/`bisect`
- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/init.js` — existing precedent for `spawnSync` usage in this codebase (git hash-object, not shell-mode, but establishes the module is already imported/used)
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/phases/03-bisect-blame/03-CONTEXT.md` — locked decisions D-01 through D-05

### Secondary (MEDIUM confidence)
- `git-bisect(1)` exit-code convention (0=good/1=bad/125=skip/128+=abort for `git bisect run`) — well-established git behavior from training knowledge, not re-fetched live this session; flagged in Assumptions Log (A1) since CONTEXT.md explicitly invited deviation if research found reason to
- Unified diff hunk-header format (`@@ -l[,s] +l[,s] @@`, count omitted when 1) — standard, stable diff format, training-data confidence, low volatility risk

### Tertiary (LOW confidence)
- None flagged — no unverified WebSearch-only claims were needed for this phase; everything either came from direct codebase inspection or long-stable git plumbing behavior.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all tooling (git blame/diff/merge-base/rev-list, node:sqlite, child_process) already verified present and in use in this exact codebase
- Architecture: HIGH — grounded in direct inspection of `snapshotWorktree`, `post-commit.js`, and `cache.js` schema, not assumed
- Pitfalls: MEDIUM-HIGH — pitfalls 1, 2, 4, 5 are codebase/format-grounded (HIGH); pitfall 3 (signal handling edge case) is flagged as needing empirical verification during implementation (MEDIUM)

**Research date:** 2026-09-02
**Valid until:** 2026-10-02 (30 days — stable git plumbing and a small, slow-moving codebase; re-check sooner only if Phase 2's cache schema changes before Phase 3 planning begins)

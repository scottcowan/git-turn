# Phase 3: bisect + blame - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 6 (2 command files, 2 test files, 1 new shared util, 1 extended cache/session module)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/commands/blame.js` | command/controller | request-response (read + git shell-out) | `src/commands/show.js` (single-turn read + fallback) and `src/commands/log.js` (cache-first, cross-session enumeration) | role-match (composite) |
| `src/commands/bisect.js` | command/controller | event-driven (binary search loop) + file-I/O (snapshot/restore) | `src/commands/revert.js` (pre-op-snapshot + guaranteed restore) | exact (structure), partial (loop is new) |
| `src/blame-util.js` (new shared module) | utility | transform (turn enumeration, index building, hunk parsing) | `src/cache.js` `rebuild()` (cross-session ref-walk) + `getTurnsForFile()` (file-scoped query) | role-match |
| `src/cache.js` (extend: `getAllTurns()`) | utility/service (extension) | CRUD (read query) | `src/cache.js` `getTurns(sessionId)` (lines 206-211) | exact — same file, sibling function |
| `src/session.js` (extend: cross-session `listAllTurns()` fallback) | utility/service (extension) | event-driven/ref-walk | `src/cache.js` `rebuild()` ref-walk (lines 128-150) reused as the no-cache fallback pattern | role-match |
| `src/commands/blame.test.js` | test | request-response (unit) | `src/commands/revert.test.js` (multi-turn fixture via `makeTurn`) | exact |
| `src/commands/bisect.test.js` | test | event-driven (unit, stdout capture) | `src/commands/revert.test.js` (snapshot/restore assertions) + `src/commands/status.test.js` (`captureStatus`-style stdout capture) | exact (composite) |

## Pattern Assignments

### `src/commands/blame.js` (controller, request-response)

**Analogs:** `src/commands/show.js` (whole file, 46 lines), `src/commands/log.js` (cache-first-then-fallback, lines 18-48), `src/cache.js` `getTurnsForFile` (lines 220-229)

**Imports pattern** (from `show.js` lines 1-4):
```javascript
'use strict';

const { git, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
```
Blame additionally needs (new, not yet imported anywhere):
```javascript
const { getAllTurns } = require('../cache'); // new export, see cache.js extension below
// or, cache-miss fallback:
const { listAllTurnsFromRefs } = require('../blame-util'); // new shared module
```

**Cache-first / fallback pattern** (`log.js` lines 18-41 — this is the template for blame's cross-session enumeration):
```javascript
// Try cache first, fall back to git object walk
if (!noCache) {
  try {
    const { getTurns } = require('../cache');
    const cached = getTurns(session.session_id);
    if (cached.length > 0) {
      // ... use cached rows ...
      return;
    }
  } catch {
    // Cache unavailable — fall through to git object walk
  }
}
// Git object walk fallback
const turns = listTurns(session.session_id);
```
Blame must use the **cross-session** equivalent of this (`getAllTurns()` / ref-walk over ALL `refs/git-turn/sessions/*/turn-*`, not `listTurns(session.session_id)`), per D-02.

**Tracked-file file-level lookup** (`src/cache.js` lines 220-229, exact function to build on top of):
```javascript
function getTurnsForFile(filePath) {
  const db = ensureCache();
  return db.prepare(`
    SELECT t.*, tf.change_type, tf.insertions, tf.deletions
    FROM turn_files tf JOIN turns t ON t.id = tf.turn_id
    WHERE tf.file_path = ?
    ORDER BY t.session_id, t.turn_n
  `).all(filePath);
}
```
Blame's line-level map is a refinement layered on top of this file-level list — do not replace it, extend it.

**"Not found" / usage error pattern** (`show.js` lines 7-17, identical convention across all read commands):
```javascript
function run(args) {
  const session = readSession();
  if (!session) { console.error('git turn: not initialized'); process.exit(1); }

  const turnN = parseInt(args[0], 10);
  if (isNaN(turnN)) { console.error('Usage: git turn show <N>'); process.exit(1); }
  // ...
  if (!turn) { console.error(`git turn: turn ${turnN} not found`); process.exit(1); }
}

module.exports = { run };
```
Blame's usage check is `<file>` (string, not int) — swap the `isNaN` guard for an existence/non-empty check on `args[0]`.

**Git shell-out convention** (project-wide rule, visible in every command file): all git calls go through `git`/`gitSafe` from `src/git.js`, always with an argv array — never string concatenation. For blame this means:
```javascript
// tracked-file path
const blameOut = gitSafe(['blame', '--porcelain', '--', file]);
// existence check before trusting git blame
const tracked = gitSafe(['ls-files', '--', file]);
```

---

### `src/commands/bisect.js` (controller, event-driven + file-I/O)

**Analog:** `src/commands/revert.js` (whole file, 45 lines) — this is the direct structural template for the pre-op-snapshot / guaranteed-restore shape.

**Imports pattern** (`revert.js` lines 1-4):
```javascript
'use strict';

const { snapshotWorktree, restoreSnapshot } = require('../git');
const { readSession, listTurns, writeOp } = require('../session');
```
Bisect additionally needs (new, no existing precedent for shell-mode spawnSync — `init.js` line 5 imports `spawnSync` but non-shell mode):
```javascript
const { spawnSync } = require('child_process');
const { gitSafe, repoRoot } = require('../git');
```

**Pre-op-snapshot + guaranteed-restore pattern** (`revert.js` lines 26-39, this is the exact skeleton to mirror, extended with try/finally for D-04):
```javascript
// Pre-revert snapshot MUST happen before any restore so redo has a concrete SHA
const { commitSha: pre_revert_snapshot_sha } = snapshotWorktree({ message: 'pre-revert snapshot (turn ' + N + ')' });

// Restore worktree to target turn state — throws on branch mismatch (D-03), propagate unhandled
restoreSnapshot(turn.sha, { branch: session.branch });

// Write revert op AFTER successful restore — avoids corrupting undo stack if restore throws
writeOp('revert', {
  session_id: session.session_id,
  turn_n: N,
  snapshot_sha: turn.sha,
  pre_revert_snapshot_sha,
  branch: session.branch,
});
```
Bisect must wrap the equivalent of the middle two steps (restore-candidate, run-cmd) in a loop inside `try { ... } finally { restoreSnapshot(pre_bisect_snapshot_sha, { branch: session.branch }); }` — revert.js does one restore with no loop and no finally (it doesn't need one, since revert IS the terminal state); bisect's loop iterates through many candidate restores before landing on the guaranteed final restore, so the `finally` is new structure layered on top of this base pattern.

**Dirty-worktree precondition (D-03)** — no exact existing analog (no command currently refuses on dirty worktree), but the check itself is a one-line `gitSafe` call following the existing usage-error convention (`revert.js`/`show.js` `console.error` + `process.exit(1)` idiom):
```javascript
const dirty = gitSafe(['status', '--porcelain']);
if (dirty) {
  console.error('git turn: bisect requires a clean worktree. Commit or stash changes first.');
  process.exit(1);
}
```

**Branch-mismatch error convention** (`git.js` lines 131-138, `restoreSnapshot` — reused verbatim, no changes needed):
```javascript
function restoreSnapshot(snapshotSha, { branch } = {}) {
  const currentBr = currentBranch();
  if (branch && branch !== currentBr) {
    throw new Error(`Branch mismatch: snapshot is from '${branch}', current branch is '${currentBr}'`);
  }
  const tree = git(['rev-parse', `${snapshotSha}^{tree}`]);
  git(['read-tree', '--reset', '-u', tree]);
}
```

**Running `<cmd>` and classifying exit code** — no existing analog for shell-mode `spawnSync`; nearest precedent is `init.js` lines 70-81 (non-shell `spawnSync` for `git hash-object`, showing the project's `spawnSync` result-object convention: check `result.status`, use `result.stdout`/`result.stderr`):
```javascript
// Source: src/commands/init.js lines 70-81 — spawnSync result-object handling convention
const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
  input: schema,
  encoding: 'utf8',
  cwd: process.cwd(),
});
if (result.status === 0) {
  const blobSha = result.stdout.trim();
  // ...
} else {
  console.error('git turn: warning: ...', (result.stderr || '').trim());
}
```
Bisect adapts this convention but switches to `shell: true` and `stdio: 'inherit'` (per RESEARCH.md Pattern 4, no exact codebase precedent for shell mode — this is new, cite `child_process` docs, not an analog):
```javascript
const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: repoRoot() });
const code = result.status;
```

**Live progress printing (D-05)** — follows the plain `console.log` convention used throughout `log.js`/`show.js` (no special formatting library):
```javascript
// Source: pattern from src/commands/log.js line 31 (padded turn number + short sha)
console.log(`  turn ${String(candidate.turn_n).padStart(2)}  ${candidate.head_sha.slice(0, 7)}  testing...`);
console.log(code === 0 ? '  PASS' : '  FAIL');
```

**Op logging** (`revert.js` lines 33-39, exact convention to reuse for `bisect-start`/`bisect-end`):
```javascript
writeOp('bisect-start', { session_id: session.session_id, cmd, pre_bisect_snapshot_sha, branch: session.branch });
// ... after search completes, in the finally or right before returning ...
writeOp('bisect-end', { result, /* e.g. found turn_n or 'not found' */ });
```

---

### `src/blame-util.js` (new shared utility module)

**Analogs:** `src/cache.js` `rebuild()` (lines 122-185, especially the ref-walk at 128-150) for cross-session enumeration; `src/cache.js` `getTurns()` (lines 206-211) for the query-shape convention.

**Cross-session ref-walk fallback pattern** (`cache.js` lines 128-150, exact code to adapt for the no-cache path):
```javascript
const refOutput = gitSafe(['for-each-ref',
  '--format=%(refname) %(objectname)',
  '--sort=refname',
  'refs/git-turn/sessions/']) || '';

const refs = refOutput.split('\n').filter(Boolean).map(line => {
  const [ref, sha] = line.split(' ');
  return { ref, sha };
});

// Group by session ...
const sessions = {};
for (const { ref, sha } of refs) {
  const m = ref.match(/refs\/git-turn\/sessions\/([^/]+)\/turn-(\d+)/);
  if (!m) continue;
  const [, sessionId, turnNStr] = m;
  const turnN = parseInt(turnNStr, 10);
  if (!sessions[sessionId]) sessions[sessionId] = [];
  sessions[sessionId].push({ turnN, snapshotSha: sha });
}
```
This is the template `getAllTurns()`'s ref-walk fallback and the new cross-session `listAllTurns()` in `session.js` should both follow — same regex, same grouping shape.

**Cache query convention** (`cache.js` lines 206-211, `getTurns`, the sibling to model `getAllTurns()` on):
```javascript
function getTurns(sessionId) {
  const db = ensureCache();
  return db.prepare('SELECT * FROM turns WHERE session_id=? ORDER BY turn_n')
           .all(sessionId);
}
```
New `getAllTurns()` drops the `WHERE` clause and orders cross-session (per RESEARCH.md: `ORDER BY ts, session_id, turn_n`):
```javascript
function getAllTurns() {
  const db = ensureCache();
  return db.prepare('SELECT * FROM turns ORDER BY ts, session_id, turn_n').all();
}
```

**head_sha → turn reverse index** — no existing analog (new pattern per RESEARCH.md Pattern 2), built directly from `getAllTurns()`'s output:
```javascript
const turns = getAllTurns();
const byHeadSha = new Map(turns.map(t => [t.head_sha, t]));
```

**Hunk-header parsing (untracked-file fallback)** — no existing analog in the codebase (new code); RESEARCH.md Pitfall 5 gives the exact regex to use, optional count group:
```javascript
/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
```

---

### `src/commands/blame.test.js` (test)

**Analog:** `src/commands/revert.test.js` (whole file, 79 lines) — the `makeTurn` helper (lines 13-21) is the exact multi-turn fixture builder to reuse/import for blame's per-line multi-turn scenarios:
```javascript
function makeTurn(session, content, git) {
  writeFileSync(join(process.cwd(), 'work.txt'), content + '\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'turn ' + (session.turn_n + 1)]);
  const { commitSha } = snapshotWorktree({ message: 'turn ' + (session.turn_n + 1) });
  incrementTurn(session);
  updateRef(turnRef(session.session_id, session.turn_n), commitSha);
  return commitSha;
}
```
Cross-session tests (D-02) will need a second `newSession()` call within the same repo — a genuinely new fixture shape not yet exercised anywhere in the existing test suite (RESEARCH.md flags this explicitly), but the single-session building blocks above are directly reusable.

**Setup/teardown convention** (`revert.test.js` lines 23-42, identical across all command tests including `status.test.js`):
```javascript
beforeEach(() => {
  origCwd = process.cwd();
  const repo = makeTestRepo();
  repoDir = repo.dir;
  git = repo.git;
  process.chdir(repoDir);
  ensureDirs();
  session = newSession();
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(repoDir, { recursive: true, force: true });
});
```

---

### `src/commands/bisect.test.js` (test)

**Analogs:** `src/commands/revert.test.js` (snapshot/restore assertion style, lines 44-57 and 70-78 for branch-mismatch) + `src/commands/status.test.js` (`captureStatus`-style stdout capture, lines 33-43) for D-05's live-progress assertions.

**Stdout capture pattern** (`status.test.js` lines 33-43, exact template to copy for bisect's progress-line assertions):
```javascript
function captureStatus() {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    require('./status').run([]);
  } finally {
    console.log = origLog;
  }
  return logs.join('\n');
}
```
Rename to `captureBisect(args)` and call `require('./bisect').run(args)`.

**Dirty-worktree / branch-mismatch assertion style** (`revert.test.js` lines 70-78, exact `assert.throws` convention to reuse for D-03):
```javascript
test('fails with branch mismatch when on different branch (D-03)', () => {
  makeTurn(session, 'v1', git);
  git(['checkout', '-b', 'other']);

  assert.throws(() => {
    run(['1']);
  }, /[Bb]ranch/);
});
```
Bisect's dirty-worktree test follows the same shape but asserts a `process.exit`/`console.error` path (or a thrown error, depending on final implementation) rather than a branch regex — match the existing usage-error convention seen in `show.js`/`diff.js` (`console.error` + `process.exit(1)`), which is not itself unit-testable via `assert.throws` unless the command is refactored to throw instead of `process.exit` (flag for planner: check whether existing tests mock `process.exit` anywhere before deciding the exact test technique — none of the read analogs currently test the `process.exit` path directly).

## Shared Patterns

### Git shell-out safety (all files)
**Source:** `src/git.js` lines 1-4 (module header comment) — project-wide rule, not a single function
**Apply to:** `blame.js`, `bisect.js`, `blame-util.js` — every git invocation
```javascript
// All git operations go through these helpers.
// Never use shell string interpolation — always pass args as an array.
```
`gitSafe(['blame', '--porcelain', '--', file])` and `gitSafe(['merge-base', '--is-ancestor', sha, 'HEAD'])` must follow this convention exactly like every existing command does.

### Session/usage-error convention (blame.js, and bisect.js's non-dirty-worktree checks)
**Source:** `src/commands/show.js` lines 7-17, mirrored identically in `diff.js`, `revert.js`, `log.js`, `status.js`
**Apply to:** `blame.js`, `bisect.js`
```javascript
const session = readSession();
if (!session) { console.error('git turn: not initialized'); process.exit(1); }
// ... arg validation ...
if (isNaN(turnN)) { console.error('Usage: git turn <cmd> <args>'); process.exit(1); }
```

### Pre-op-snapshot + guaranteed-restore (bisect.js)
**Source:** `src/commands/revert.js` lines 26-39
**Apply to:** `bisect.js` (extended with a loop and `try/finally` — see Pattern Assignments above)

### Op log write-after-success (bisect.js)
**Source:** `src/commands/revert.js` lines 33-39 comment: "Write revert op AFTER successful restore — avoids corrupting undo stack if restore throws"
**Apply to:** `bisect.js`'s `bisect-start`/`bisect-end` writes — same ordering discipline (write the op that records state transitions only once the transition itself has succeeded)

### Cache-first, ref-walk-fallback (blame.js, blame-util.js)
**Source:** `src/commands/log.js` lines 18-41 (command-level example) + `src/cache.js` `ensureCache()`/`rebuild()` (module-level example, lines 122-198)
**Apply to:** `blame.js`'s cross-session turn enumeration, and any bisect candidate-list building that also wants cache-first behavior

### Command module export shape (all new command files)
**Source:** every file in `src/commands/` — universal, zero exceptions
```javascript
function run(args) { /* ... */ }
module.exports = { run };
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Shell-mode `spawnSync(cmd, {shell:true, stdio:'inherit'})` invocation in `bisect.js` | utility (inline) | event-driven | No existing command runs an arbitrary user shell string; `init.js`'s `spawnSync` usage is non-shell-mode (git subprocess with argv array) and is only a partial precedent for the result-object handling convention, not the shell-mode call shape itself. Use RESEARCH.md's Pattern 4/Code Examples directly. |
| Binary search loop structure in `bisect.js` | controller (inline logic) | event-driven | No existing command implements any search/loop-with-narrowing logic — all existing commands are single-pass read or single-restore write. Use RESEARCH.md's Architecture Diagram (bisect) step 4 directly as the algorithm skeleton. |
| Untracked-file hunk-diff line annotator in `blame-util.js` | utility | transform | No existing hand-rolled diff-hunk parser anywhere in the codebase (git blame is always shelled out to elsewhere). Use RESEARCH.md Pitfall 5's regex and Pattern/Diagram step [3b] directly. |
| `SIGINT`/`SIGTERM` handler for bisect interruption safety | utility (inline) | event-driven | No existing command registers process signal handlers. RESEARCH.md flags this as a residual risk (Pitfall 3) requiring empirical verification during implementation, not a pattern to copy from elsewhere in this codebase. |

## Metadata

**Analog search scope:** `src/commands/*.js`, `src/commands/*.test.js`, `src/cache.js`, `src/git.js`, `src/session.js`, `src/helpers/test-repo.js`, `bin/git-turn`
**Files scanned:** 13 (show.js, log.js, diff.js, revert.js, revert.test.js, status.js, status.test.js, init.js, cache.js, git.js, session.js, test-repo.js, bin/git-turn)
**Pattern extraction date:** 2026-09-02

# Phase 1: Core Commands - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 15 (new/modified)
**Analogs found:** 14 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/commands/diff.js` | command | request-response | `src/commands/show.js` | exact |
| `src/commands/revert.js` | command | CRUD | `src/commands/init.js` | role-match |
| `src/commands/redo.js` | command | CRUD | `src/commands/init.js` + `src/session.js` | role-match |
| `src/commands/status.js` | command | request-response | `src/commands/log.js` | exact |
| `src/commands/gc.js` | command | batch | `src/commands/init.js` + `src/git.js` | role-match |
| `src/commands/init.js` | command | CRUD | self (modify existing) | self |
| `src/git.js` | utility | transform | self (modify existing) | self |
| `package.json` | config | — | self (modify one field) | self |
| `src/commands/diff.test.js` | test | request-response | RESEARCH.md code example | no analog |
| `src/commands/revert.test.js` | test | CRUD | RESEARCH.md code example | no analog |
| `src/commands/redo.test.js` | test | CRUD | RESEARCH.md code example | no analog |
| `src/commands/status.test.js` | test | request-response | RESEARCH.md code example | no analog |
| `src/commands/gc.test.js` | test | batch | RESEARCH.md code example | no analog |
| `src/commands/init.test.js` | test | CRUD | RESEARCH.md code example | no analog |
| `src/helpers/test-repo.js` | utility | — | RESEARCH.md code example | no analog |

---

## Pattern Assignments

### `src/commands/diff.js` (command, request-response)

**Analog:** `src/commands/show.js`

**Imports pattern** (`src/commands/show.js` lines 1-4):
```javascript
'use strict';

const { git, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
```

**Session guard pattern** (`src/commands/show.js` lines 7-9):
```javascript
const session = readSession();
if (!session) { console.error('git turn: not initialized'); process.exit(1); }
```

**Arg parsing with isNaN guard** (`src/commands/show.js` lines 10-11):
```javascript
const turnN = parseInt(args[0], 10);
if (isNaN(turnN)) { console.error('Usage: git turn show <N>'); process.exit(1); }
```

**Turn lookup with error exit** (`src/commands/show.js` lines 13-17):
```javascript
const turns = listTurns(session.session_id);
const turn = turns.find(t => t.turn_n === turnN);
const prev = turns.find(t => t.turn_n === turnN - 1);
if (!turn) { console.error(`git turn: turn ${turnN} not found`); process.exit(1); }
```

**Empty-tree fallback for first turn** (`src/commands/show.js` lines 34-41):
```javascript
if (prev) {
  const diffOut = gitSafe(['diff', prev.sha, turn.sha]) || '(no changes)';
  console.log(diffOut);
} else {
  // First turn — diff against empty tree
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const diffOut = gitSafe(['diff', emptyTree, turn.sha]) || '(no changes)';
  console.log(diffOut);
}
```

**Module export pattern** (`src/commands/show.js` line 45):
```javascript
module.exports = { run };
```

**diff-specific additions** (from RESEARCH.md Pattern 2 — verified against local codebase):
- Import only `gitSafe` (no `git`) and `{ readSession, listTurns }` (no `NOTES_REF`)
- Parse optional second arg `M`; if present use `findTurn(N).sha` vs `findTurn(M).sha` (D-04)
- If single arg, behave exactly like `show.js`'s prev/empty-tree pattern (D-05)
- `gitSafe(['diff', shaA, shaB]) || '(no changes)'` — use `gitSafe` so a clean diff (exit 0, empty output) returns empty string, not throws

---

### `src/commands/revert.js` (command, CRUD)

**Analog:** `src/commands/init.js` (state-modifying command shape)

**Imports pattern** (`src/commands/init.js` lines 1-6):
```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir, git } = require('../git');
const { newSession, ensureDirs } = require('../session');
```

**revert-specific imports** (compose from existing exports):
```javascript
'use strict';

const { snapshotWorktree, restoreSnapshot } = require('../git');
const { readSession, listTurns, writeOp } = require('../session');
```

**Session guard** (same as all read commands — `src/commands/show.js` line 7-9):
```javascript
const session = readSession();
if (!session) { console.error('git turn: not initialized'); process.exit(1); }
```

**Error propagation pattern** (`src/commands/init.js` lines 25-27 — let errors surface):
```javascript
// Cross-branch fail: restoreSnapshot() throws on branch mismatch — let it propagate (D-03)
// No try/catch around restoreSnapshot(); error message comes from git.js
```

**Op log write pattern** (`src/hooks/post-commit.js` lines 28 and 60-68):
```javascript
// Before the state change:
writeOp('before-turn', { session_id: session.session_id, turn_n: turnN, head, branch, ts });

// After the state change:
writeOp('after-turn', { session_id: session.session_id, turn_n: turnN, ... });
```

**revert op schema** (RESEARCH.md Pattern 3 — pre-revert snapshot then restore):
```javascript
// Step 1: capture current state so redo can restore it
const { commitSha: preRevertSha } = snapshotWorktree({ message: 'pre-revert snapshot' });

// Step 2: write op with everything redo needs
writeOp('revert', {
  session_id: session.session_id,
  turn_n: N,
  snapshot_sha: turn.sha,        // SHA we restored TO
  pre_revert_snapshot_sha: preRevertSha,  // SHA redo must restore FROM
  branch: session.branch,
});

// Step 3: restore worktree (throws on branch mismatch — D-03)
restoreSnapshot(turn.sha, { branch: session.branch });
```

---

### `src/commands/redo.js` (command, CRUD)

**Analog:** `src/commands/init.js` shape + `src/session.js` readOps

**Imports pattern**:
```javascript
'use strict';

const { restoreSnapshot } = require('../git');
const { readSession, readOps, writeOp } = require('../session');
```

**Session guard** (same pattern, all commands):
```javascript
const session = readSession();
if (!session) { console.error('git turn: not initialized'); process.exit(1); }
```

**LIFO op search** (`src/session.js` lines 83-88 — readOps() returns ts-sorted ascending array):
```javascript
// readOps() sorts by ts ascending — reverse for LIFO
function readOps() {
  return fs.readdirSync(opsDir())
    .map(f => JSON.parse(fs.readFileSync(path.join(opsDir(), f), 'utf8')))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
```

**redo LIFO pattern** (RESEARCH.md Pattern 3 + anti-pattern note on LIFO ordering):
```javascript
const ops = readOps();
// Find last revert not yet redeemed by a redo op
const redeemedHashes = new Set(
  ops.filter(op => op.type === 'redo').map(op => op.revert_op_hash)
);
const lastRevert = [...ops].reverse().find(
  op => op.type === 'revert' && !redeemedHashes.has(/* op hash */)
);
if (!lastRevert) { console.error('git turn: nothing to redo'); process.exit(1); }

restoreSnapshot(lastRevert.pre_revert_snapshot_sha, { branch: lastRevert.branch });

// Mark this revert as consumed so double-redo errors correctly
writeOp('redo', {
  session_id: session.session_id,
  revert_turn_n: lastRevert.turn_n,
  restored_snapshot_sha: lastRevert.pre_revert_snapshot_sha,
});
```

**Note on op hash for redo:** `writeOp()` returns the hash (`src/session.js` line 79: `return hash`). `revert` must capture that return value and include it in the op payload so `redo` can match it. Pattern:
```javascript
// In revert.js:
const opHash = writeOp('revert', { ..., self_hash: null });
// In redo.js: match by revert_op_hash field written into the redo op
```

---

### `src/commands/status.js` (command, request-response)

**Analog:** `src/commands/log.js` (read-only session consumer)

**Imports pattern** (`src/commands/log.js` lines 1-4):
```javascript
'use strict';

const { git, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
```

**status-specific imports** (D-06/D-07 — needs fs for hook check, path for hook path):
```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir } = require('../git');
const { readSession, listTurns } = require('../session');
```

**Session guard** (`src/commands/log.js` lines 7-11):
```javascript
const session = readSession();
if (!session) {
  console.error('git turn: not initialized. Run `git turn init` first.');
  process.exit(1);
}
```

**gitDir() relative-path usage** (`src/commands/init.js` lines 15-17 — gitDir() returns `.git`):
```javascript
const gd = gitDir();
const hooksDir = path.join(gd, 'hooks');
const hookPath = path.join(hooksDir, 'post-commit');
```

**Hook health check** (D-07 — file presence + string check; mirrors init.js lines 20-27):
```javascript
let hookStatus = 'missing';
if (fs.existsSync(hookPath)) {
  const content = fs.readFileSync(hookPath, 'utf8');
  hookStatus = content.includes('git-turn') ? 'installed' : 'not from git-turn';
}
```

**Session field access** (`src/session.js` lines 37-46 — fields written by newSession()):
```javascript
// session object has: session_id, turn_n, branch, started, preexisting_untracked
// listTurns() gives the authoritative count (may differ from session.turn_n after gc)
const turns = listTurns(session.session_id);
console.log(`Session:  ${session.session_id}`);
console.log(`Branch:   ${session.branch}`);
console.log(`Turns:    ${turns.length}`);
console.log(`Started:  ${session.started}`);
console.log(`Hook:     ${hookStatus}`);
```

---

### `src/commands/gc.js` (command, batch)

**Analog:** `src/commands/init.js` (state-modifying) + `src/git.js` listRefs/deleteRef

**Imports pattern**:
```javascript
'use strict';

const { listRefs, deleteRef, gitSafe } = require('../git');
const { readSession } = require('../session');
```

**Session guard** (gc can still run without active session — but needs readSession to protect current session):
```javascript
const currentSession = readSession(); // may be null — that's fine for gc
```

**listRefs usage** (`src/git.js` lines 54-61):
```javascript
function listRefs(prefix) {
  const out = gitSafe(['for-each-ref', '--format=%(refname) %(objectname)', prefix]);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const [ref, sha] = line.split(' ');
    return { ref, sha };
  });
}
```

**deleteRef usage** (`src/git.js` lines 49-51):
```javascript
function deleteRef(ref) {
  git(['update-ref', '-d', ref]);
}
```

**Session age ordering** (RESEARCH.md Pattern 5 — sort by creatordate, not UUID):
```javascript
// Use for-each-ref with creatordate sort to get sessions oldest-first (D-08/Pitfall 6)
const out = gitSafe([
  'for-each-ref',
  '--format=%(refname) %(creatordate:iso-strict)',
  '--sort=creatordate',
  'refs/git-turn/sessions/',
]);
```

**Arg parsing for --keep-sessions** (D-08):
```javascript
const keepIdx = args.indexOf('--keep-sessions');
const keepN = keepIdx !== -1 ? parseInt(args[keepIdx + 1], 10) : 10;
```

**GC hint message** (D-10 — exact string required):
```javascript
console.log("Snapshot objects will be reclaimed on next 'git gc'");
```

**Never prune current session guard** (D-09):
```javascript
if (currentSession && sessionId === currentSession.session_id) continue;
```

---

### `src/commands/init.js` — MODIFY (add format blob write)

**Existing file:** `src/commands/init.js` (50 lines — read in full above)

**spawnSync stdin pattern** (RESEARCH.md Pattern 6 — no new helper needed):
```javascript
const { spawnSync } = require('child_process');

// Add to run(), after session is created:
const schema = JSON.stringify({
  version: '1',
  tool: 'git-turn',
  schema: 'turns/v1',
  ref_pattern: 'refs/git-turn/sessions/{id}/turn-{N}',
  notes_ref: 'refs/notes/git-turn',
});
const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
  input: schema,
  encoding: 'utf8',
  cwd: process.cwd(),
});
if (result.status === 0) {
  const blobSha = result.stdout.trim();
  git(['update-ref', 'refs/git-turn/format', blobSha]);
  console.log('✓ Wrote format discovery blob: refs/git-turn/format');
}
```

**CRITICAL:** Use `refs/git-turn/format` NOT `refs/turns/.format` — git rejects ref components starting with `.` (RESEARCH.md Pitfall 1, verified).

**Existing git() import** (`src/commands/init.js` line 5): `git` is already imported — no additional import needed beyond `spawnSync`.

---

### `src/git.js` — MODIFY (optional gitInput() helper)

**Existing file:** `src/git.js` (142 lines — read in full above)

**At-discretion addition** — if `spawnSync` stdin pattern is used in more than one place, extract helper. Pattern to follow (`src/git.js` lines 11-17 — existing `git()` helper shape):
```javascript
function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  }).trim();
}
```

**gitInput() helper** (optional — only if stdin needed in 2+ places):
```javascript
function gitInput(args, input, opts = {}) {
  const { spawnSync } = require('child_process');
  const result = spawnSync('git', args, {
    input,
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
```

**Export pattern** (`src/git.js` lines 137-142):
```javascript
module.exports = {
  git, gitSafe, repoRoot, gitDir, headSha, currentBranch,
  updateRef, deleteRef, listRefs,
  snapshotWorktree, restoreSnapshot,
  addNote, getNote,
};
```

---

### `package.json` — MODIFY (fix test script)

**Current value** (RESEARCH.md Pitfall 2 — `/bin/sh` does not expand `**`):
```json
"test": "node --test src/**/*.test.js"
```

**Correct value** (auto-discovers `**/*.test.js` recursively from cwd):
```json
"test": "node --test"
```

---

## Shared Patterns

### Session Guard
**Source:** `src/commands/log.js` lines 7-11 and `src/commands/show.js` lines 7-9
**Apply to:** `diff.js`, `revert.js`, `redo.js`, `status.js` (all read-commands and state-mutating commands)
**Note:** `gc.js` does NOT require a session — it reads `readSession()` only to protect the current session from pruning.
```javascript
const session = readSession();
if (!session) {
  console.error('git turn: not initialized. Run `git turn init` first.');
  process.exit(1);
}
```

### No Shell Interpolation
**Source:** `src/git.js` lines 3-5 (comment) + all existing commands
**Apply to:** All new command files — all git calls must use `execFileSync('git', argsArray)`
```javascript
// CORRECT:
gitSafe(['diff', shaA, shaB])
git(['update-ref', '-d', ref])

// NEVER:
execFileSync('git', [`diff ${shaA}..${shaB}`])  // WRONG
```

### Module Export Shape
**Source:** `src/commands/init.js` line 50, `src/commands/log.js` line 42, `src/commands/show.js` line 45
**Apply to:** All new command files
```javascript
module.exports = { run };
```

### Op Log Write
**Source:** `src/hooks/post-commit.js` lines 28, 60-68 and `src/session.js` lines 74-79
**Apply to:** `revert.js`, `redo.js`
```javascript
// writeOp returns the hash of the op file — capture it if needed for cross-referencing
const opHash = writeOp('revert', {
  session_id: session.session_id,
  // ... payload
});
```

### LIFO Op Read
**Source:** `src/session.js` lines 83-88 (`readOps()` returns ascending ts-sorted array)
**Apply to:** `redo.js`
```javascript
// readOps() returns ascending order — reverse for LIFO
const lastRevert = [...readOps()].reverse().find(op => op.type === 'revert');
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/commands/diff.test.js` | test | request-response | No test files exist in codebase yet |
| `src/commands/revert.test.js` | test | CRUD | No test files exist in codebase yet |
| `src/commands/redo.test.js` | test | CRUD | No test files exist in codebase yet |
| `src/commands/status.test.js` | test | request-response | No test files exist in codebase yet |
| `src/commands/gc.test.js` | test | batch | No test files exist in codebase yet |
| `src/commands/init.test.js` | test | CRUD | No test files exist in codebase yet |
| `src/helpers/test-repo.js` | utility | — | No test helpers exist in codebase yet |

**All test files:** Use RESEARCH.md "Test Helper: Temp Git Repo Setup/Teardown" pattern (lines 439-489 of RESEARCH.md). Key elements:
- `makeTestRepo()` returns `{ dir, git }` — local `git()` scoped to temp dir
- `beforeEach`: `origCwd = process.cwd(); chdir(repoDir)`
- `afterEach`: `chdir(origCwd); rmSync(repoDir, { recursive: true, force: true })`
- `HOME: dir` in env to isolate git config
- `describe` / `test` / `beforeEach` / `afterEach` from `node:test`
- `assert` from `node:assert/strict`

**`src/helpers/test-repo.js`** exports `makeTestRepo()` so each test file can `require('../helpers/test-repo')` rather than duplicating setup.

---

## Key Anti-Patterns (from RESEARCH.md — enforce in all new files)

| Anti-Pattern | Correct Pattern | Source |
|---|---|---|
| `refs/turns/.format` as ref name | `refs/git-turn/format` | RESEARCH.md Pitfall 1 |
| `node --test src/**/*.test.js` in npm script | `node --test` | RESEARCH.md Pitfall 2 |
| `process.chdir()` at module level in tests | `chdir()` inside `beforeEach`/`afterEach` | RESEARCH.md Pitfall 7 |
| `readOps().find(op => ...)` for LIFO | `[...readOps()].reverse().find(op => ...)` | RESEARCH.md Pitfall 4 |
| Shell string interpolation in git args | Array args always | `src/git.js` lines 3-5 |

---

## Metadata

**Analog search scope:** `src/commands/`, `src/git.js`, `src/session.js`, `src/hooks/`, `bin/`
**Files scanned:** 7 existing source files read in full
**Pattern extraction date:** 2026-08-09

# Phase 1: Core commands - Research

**Researched:** 2026-08-09
**Domain:** Node.js git extension — CLI commands, git plumbing, op log
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `git turn revert <N>` restores worktree + index only. HEAD stays. Uses `restoreSnapshot()`.
- **D-02:** `git turn redo` undoes last revert only (LIFO). No full op-log traversal in this phase.
- **D-03:** Cross-branch revert is a hard fail — let `restoreSnapshot()` throw propagate.
- **D-04:** `git turn diff N M` diffs snapshot worktree-trees of turn N and M (not HEAD commits).
- **D-05:** `git turn diff N` (single arg) diffs turn N-1 vs turn N.
- **D-06:** `git turn status` shows session summary only: session ID, turn count, branch, hook health, started time.
- **D-07:** Hook health = file presence check only. `.git/hooks/post-commit` exists and contains `git-turn`. No test-fire.
- **D-08:** Default gc retention is last 10 sessions. Configurable via `--keep-sessions N`.
- **D-09:** GC deletes refs only. Dangling snapshot commits become eligible for `git gc`.
- **D-10:** After gc pruning, print: `Snapshot objects will be reclaimed on next 'git gc'`.
- **D-11:** At `git turn init`, write JSON blob to a ref via `git hash-object -w --stdin` + `git update-ref`. Must include `version` and `tool` fields.
- **D-12:** Test suite uses Node.js built-in `--test` runner. Tests live in `src/**/*.test.js`.

### Claude's Discretion
- Exact JSON schema for the format discovery blob (beyond required `version` and `tool` fields).
- Op type names and payload schema for revert/redo op log entries.
- Test helper patterns (temp repo setup/teardown).
- Whether to add a `gitInput()` helper to `git.js` for stdin piping.
- Valid ref name for the format blob (CONTEXT says `refs/turns/.format` which is invalid — see Critical Bug below).

### Deferred Ideas (OUT OF SCOPE)
- `blame`, `bisect`, `branch`, `session` commands — Phase 3 / Phase 6
- SQLite read cache — Phase 2
- Prompt capture (`--with-prompts`) — Phase 4
</user_constraints>

---

## Summary

Phase 1 completes the v0.1 CLI surface by implementing five missing commands (`diff`, `revert`, `redo`, `status`, `gc`) and a full test suite. All five commands compose directly from existing primitives in `src/git.js` and `src/session.js` — no new git plumbing is needed.

**Critical bug to fix at planning time:** The ref name `refs/turns/.format` specified in D-11 is rejected by git (`git check-ref-format` returns non-zero). Git forbids ref path components that begin with a dot. The valid ref name is `refs/git-turn/format`, which stays in the existing `refs/git-turn/` namespace and passes all git ref validation checks.

The most significant design decision is the **op log schema for revert/redo**: `revert` must write a `revert` op containing the pre-revert snapshot SHA and branch so `redo` can restore it via `restoreSnapshot()` without referencing the turn ref again. The test strategy uses temp git repos created per-test (not mocks) because the codebase has no seam for injecting git calls — the investment in real-repo tests pays dividends for all future phases.

**Primary recommendation:** Implement commands in order: `diff` (read-only, validates test infra), `status` (read-only, simple), `revert + redo` (stateful pair), `gc` (destructive, test last), then add the format blob to `init`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Turn diffing | CLI process | git object store | Diff is computed by git diff on snapshot commits; CLI formats output |
| Snapshot restore (revert) | CLI process | git working tree | `read-tree --reset -u` modifies worktree; CLI validates branch, writes op log |
| Redo | CLI process | fs (op log) | Reads last revert op from `.git/git-turn/ops/`, calls same restore primitive |
| Session status | CLI process | fs (session.json), fs (hooks dir) | Reads session.json and checks hook file presence |
| GC | CLI process | git refs | Enumerates refs, deletes stale ones; git itself handles object cleanup |
| Format discovery blob | git object store | git refs | Blob lives in git object store, addressable via ref |

---

## Standard Stack

### Core (no new dependencies — all built-in)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins | >=18 | fs, path, crypto, child_process | Already the project's constraint |
| `node:test` | Node 18 built-in | Test runner | Already in package.json test script |
| `node:assert/strict` | Node 18 built-in | Test assertions | Strict mode catches type mismatches |
| git CLI | system | All git operations | Project decision — no libgit2 |

[VERIFIED: local codebase] No external dependencies are needed or desired for this phase.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `execFileSync` | Node built-in | Sync git calls in commands | All git operations in command modules |
| `spawnSync` | Node built-in | Git calls with stdin input | Only for `git hash-object --stdin` in init |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `spawnSync` for stdin | Write to tmp file + `git hash-object <file>` | Tmp file avoids new helper but requires cleanup; `spawnSync` is cleaner |
| Real git repos in tests | Mock git calls | Mocks need maintenance when git API changes; real repos catch actual git edge cases |

**Installation:** No new packages to install.

## Package Legitimacy Audit

No external packages are added in this phase. The phase adds only new files within the existing codebase.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
git turn <cmd> [args]
        |
   bin/git-turn (dispatcher)
        |
   src/commands/<cmd>.js
        |
   +----+----+----+----+-----+
   |    |    |    |    |     |
  diff status revert redo gc
   |    |    |    |    |     |
   v    v    v    v    v     |
src/session.js          src/git.js
  readSession()           git()
  listTurns()             gitSafe()
  writeOp()               restoreSnapshot()
  readOps()               listRefs()
                          deleteRef()
                          snapshotWorktree() [init only]
        |
   .git/ (object store + refs + ops dir)
     refs/git-turn/sessions/{id}/turn-{N}  (snapshot SHAs)
     refs/git-turn/format                  (discovery blob)
     .git/git-turn/session.json            (current session)
     .git/git-turn/ops/{hash}              (op log entries)
     .git/hooks/post-commit                (hook health check)
```

### Recommended Project Structure
```
src/
├── commands/
│   ├── init.js         # EXISTS — add format blob write
│   ├── log.js          # EXISTS
│   ├── show.js         # EXISTS
│   ├── diff.js         # NEW
│   ├── revert.js       # NEW
│   ├── redo.js         # NEW
│   ├── status.js       # NEW
│   └── gc.js           # NEW
├── hooks/
│   └── post-commit.js  # EXISTS
├── git.js              # EXISTS — add gitInput() helper
├── session.js          # EXISTS
└── commands/
    ├── diff.test.js    # NEW
    ├── revert.test.js  # NEW
    ├── redo.test.js    # NEW
    ├── status.test.js  # NEW
    └── gc.test.js      # NEW
```

### Pattern 1: Command Module Shape

Every command follows the same shape established by `init.js`, `log.js`, `show.js`:

```javascript
// Source: src/commands/log.js (existing)
'use strict';

const { readSession, listTurns } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }
  // ... command logic
}

module.exports = { run };
```

[VERIFIED: local codebase]

### Pattern 2: diff Command Implementation

`git diff` on two snapshot commit SHAs compares their worktree-trees automatically (git treats commit->tree transparently). [VERIFIED: tested locally]

```javascript
// src/commands/diff.js
'use strict';
const { gitSafe } = require('../git');
const { readSession, listTurns } = require('../session');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function run(args) {
  const session = readSession();
  if (!session) { console.error('git turn: not initialized'); process.exit(1); }

  const N = parseInt(args[0], 10);
  if (isNaN(N)) { console.error('Usage: git turn diff <N> [M]'); process.exit(1); }

  const M = args[1] !== undefined ? parseInt(args[1], 10) : null;
  if (args[1] !== undefined && isNaN(M)) {
    console.error('Usage: git turn diff <N> [M]'); process.exit(1);
  }

  const turns = listTurns(session.session_id);

  function findTurn(n) {
    const t = turns.find(t => t.turn_n === n);
    if (!t) { console.error(`git turn: turn ${n} not found`); process.exit(1); }
    return t;
  }

  let shaA, shaB;
  if (M !== null) {
    // D-04: diff turn N vs turn M (both explicit)
    shaA = findTurn(N).sha;
    shaB = findTurn(M).sha;
  } else {
    // D-05: diff turn N-1 vs turn N
    const turnB = findTurn(N);
    shaB = turnB.sha;
    const prevTurn = turns.find(t => t.turn_n === N - 1);
    shaA = prevTurn ? prevTurn.sha : EMPTY_TREE;
  }

  const out = gitSafe(['diff', shaA, shaB]) || '(no changes)';
  console.log(out);
}

module.exports = { run };
```

[VERIFIED: git diff on two snapshot commits diffs their trees — tested locally]

### Pattern 3: revert + redo Op Log Schema

`revert` writes a `revert` op containing everything `redo` needs to restore the pre-revert state. `redo` finds the last `revert` op (LIFO) and calls `restoreSnapshot()` with its saved data. [ASSUMED: schema design; pattern consistent with existing `before-turn`/`after-turn` ops]

```javascript
// revert writes:
writeOp('revert', {
  session_id: session.session_id,
  turn_n: N,            // which turn was reverted to
  snapshot_sha: turn.sha,  // SHA of the turn we restored TO
  // pre-revert state to restore from (what redo needs):
  pre_revert_snapshot_sha: preRevertSha,  // SHA of the snapshot before revert
  branch: session.branch,
});

// redo reads:
const ops = readOps();
const lastRevert = [...ops].reverse().find(op => op.type === 'revert');
if (!lastRevert) { console.error('git turn: nothing to redo'); process.exit(1); }
restoreSnapshot(lastRevert.pre_revert_snapshot_sha, { branch: lastRevert.branch });
```

**The pre_revert_snapshot_sha problem:** At revert time, the current worktree state may not have a snapshot ref yet (the latest snapshot is `turn.sha` for the last captured turn, not the current uncommitted changes). `revert` should take a snapshot of the current worktree BEFORE restoring, so `redo` can restore to that exact state.

Revised `revert` flow:
1. Call `snapshotWorktree({ message: 'pre-revert snapshot' })` to capture current state.
2. Write `revert` op with `pre_revert_snapshot_sha = commitSha` from step 1.
3. Call `restoreSnapshot(turn.sha, { branch: session.branch })`.

[ASSUMED: taking a pre-revert snapshot is the cleanest approach]

### Pattern 4: status Command

```javascript
// src/commands/status.js
'use strict';
const fs = require('fs');
const path = require('path');
const { gitDir, currentBranch } = require('../git');
const { readSession, listTurns } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) { console.error('git turn: not initialized'); process.exit(1); }

  const turns = listTurns(session.session_id);
  const gd = gitDir();

  // D-07: hook health = file presence + string check
  const hookPath = path.join(gd, 'hooks', 'post-commit');
  let hookStatus = 'missing';
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf8');
    hookStatus = content.includes('git-turn') ? 'installed' : 'not from git-turn';
  }

  console.log(`Session:  ${session.session_id}`);
  console.log(`Branch:   ${session.branch}`);
  console.log(`Turns:    ${turns.length}`);
  console.log(`Started:  ${session.started}`);
  console.log(`Hook:     ${hookStatus}`);
}

module.exports = { run };
```

Note: `gitDir()` returns `'.git'` (relative) — all path.join operations resolve correctly when `process.cwd()` is the repo root. [VERIFIED: local codebase, tested locally]

### Pattern 5: gc Command — Session Enumeration

Sessions are enumerated by extracting unique session IDs from all `refs/git-turn/sessions/` refs. Session age is determined by the `for-each-ref creatordate` of the lowest-numbered turn ref per session (or by parsing the `created` field from the snapshot commit message). [VERIFIED: git for-each-ref with creatordate tested locally]

```javascript
// Session enumeration for gc
function listSessions() {
  const { listRefs, git } = require('../git');
  const prefix = 'refs/git-turn/sessions/';
  const refs = listRefs(prefix);
  
  // Extract unique session IDs + min turn per session
  const sessionMap = new Map(); // sessionId -> [{ref, sha, turn_n}]
  for (const { ref, sha } of refs) {
    const rest = ref.replace(prefix, '');
    const [sessionId] = rest.split('/');
    const turnN = parseInt(rest.split('/turn-')[1], 10);
    if (!sessionMap.has(sessionId)) sessionMap.set(sessionId, []);
    sessionMap.get(sessionId).push({ ref, sha, turn_n: turnN });
  }
  
  // Sort sessions by oldest turn-1 creatordate
  const sessions = [...sessionMap.entries()].map(([id, turns]) => ({
    id,
    turns: turns.sort((a, b) => a.turn_n - b.turn_n),
  }));
  // Order by snapshot commit author date (from message or creatordate)
  return sessions; // caller sorts by age then slices
}
```

### Pattern 6: Format Discovery Blob

[CRITICAL BUG IN D-11] `refs/turns/.format` is rejected by git — a ref component cannot begin with a dot. Use `refs/git-turn/format` instead. [VERIFIED: git check-ref-format tested locally]

```javascript
// In src/commands/init.js, add to run():
const { spawnSync } = require('child_process');

// Write format discovery blob (D-11)
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
});
if (result.status === 0) {
  const blobSha = result.stdout.trim();
  git(['update-ref', 'refs/git-turn/format', blobSha]);
  console.log('✓ Wrote format discovery blob: refs/git-turn/format');
}
```

Alternative (no new helper): write JSON to a temp file, call `git(['hash-object', '-w', tmpFile])`, then delete the file. Either approach works. [VERIFIED: both patterns tested locally]

### Anti-Patterns to Avoid

- **Shell string interpolation in git calls:** Never `execFileSync('git', ['diff', `${sha1}..${sha2}`])`. Always separate args: `['diff', sha1, sha2]`. [VERIFIED: project rule, enforced in all existing code]
- **process.chdir() at module level in test files:** Test files run in parallel worker threads. `chdir()` at module scope races across files. Use `chdir()` inside `beforeEach`/`afterEach` only. [VERIFIED: tested locally — module-level chdir fails]
- **Relying on `node --test src/**/*.test.js` glob:** The `**` glob is shell-expanded before Node sees it; `/bin/sh` (used by npm scripts) does not support `**` glob. Node 18 `--test` with no args auto-discovers `**/*.test.js` recursively from cwd. Change package.json test script to `node --test`. [VERIFIED: tested locally]
- **Using `refs/turns/.format` as ref name:** Git rejects any ref component starting with `.`. The correct ref is `refs/git-turn/format`. [VERIFIED: git check-ref-format tested locally]
- **Using `readOps()` order directly for LIFO redo:** Op filenames are SHA256 hashes (not time-ordered). Always reverse-sort by `ts` field to find the last op. [VERIFIED: readOps() sorts by ts, reverse().find() gives correct LIFO result]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worktree snapshot/restore | Custom git porcelain | `snapshotWorktree()` / `restoreSnapshot()` in `src/git.js` | Already handles untracked files, batched adds, branch checking |
| Turn listing and sorting | Custom ref parsing | `listTurns(sessionId)` in `src/session.js` | Handles sort, parses turn number from ref name |
| Ref CRUD | Shell exec with string concat | `updateRef()`, `deleteRef()`, `listRefs()` in `src/git.js` | No interpolation, handles all ref formats |
| Empty tree SHA | Hardcoded elsewhere | `4b825dc642cb6eb9a060e54bf8d69288fbee4904` (git constant) | Same value across all git versions, already used in `show.js` |

**Key insight:** The existing helpers in `git.js` and `session.js` cover all primitives needed by every new command. Phase 1 is assembly, not plumbing.

---

## Runtime State Inventory

Not applicable — this is a greenfield implementation of new command files. No rename/refactor/migration involved.

---

## Common Pitfalls

### Pitfall 1: `refs/turns/.format` ref name is invalid
**What goes wrong:** `git update-ref refs/turns/.format <sha>` exits with `refusing to update ref with bad name`. The `init` command fails silently or crashes.
**Why it happens:** Git forbids ref components that start with `.` (git check-ref-format rule 5).
**How to avoid:** Use `refs/git-turn/format` — consistent with the existing refs namespace and passes all git ref validation. [VERIFIED: tested locally]
**Warning signs:** `fatal: update_ref failed for ref '...': refusing to update ref with bad name`

### Pitfall 2: `node --test src/**/*.test.js` glob fails in npm scripts
**What goes wrong:** `npm test` returns "no matches found: src/**/*.test.js" if no test files exist yet, or silently omits nested files on `sh` which doesn't support `**`.
**Why it happens:** `/bin/sh` (used by npm scripts on macOS) does not support `**` glob syntax. Node 18 `--test` does not expand globs itself.
**How to avoid:** Change package.json test script to `node --test` (no args). Node 18 auto-discovers `**/*.test.js` recursively from cwd. [VERIFIED: tested locally]
**Warning signs:** "no matches found" error, or tests in subdirectories not running.

### Pitfall 3: gitDir() returns relative path
**What goes wrong:** `path.join(gitDir(), 'hooks', 'post-commit')` returns `'.git/hooks/post-commit'` — a relative path that resolves against `process.cwd()`. If a test `chdir()`s to a temp repo, this works correctly. If called from outside the repo root, it silently checks the wrong path.
**Why it happens:** `git rev-parse --git-dir` returns `.git` (relative) for normal repos.
**How to avoid:** Always call `gitDir()` after `chdir()`-ing to the repo root in tests. In production this is correct because bin/git-turn runs from the user's cwd which is in the repo. [VERIFIED: local codebase]
**Warning signs:** Hook health reporting `missing` when hook clearly exists.

### Pitfall 4: Op log LIFO ordering — sort by ts, not filename
**What goes wrong:** `readOps()` returns ops sorted by `ts` field (ascending). Simply calling `.find(op => op.type === 'revert')` returns the FIRST revert, not the LAST. Redo undoes the wrong revert.
**Why it happens:** Op filenames are SHA256 hashes — not lexicographically time-ordered.
**How to avoid:** Use `[...readOps()].reverse().find(op => op.type === 'revert')` for LIFO. [VERIFIED: readOps() sort tested locally]
**Warning signs:** `redo` restoring an older state than expected.

### Pitfall 5: pre-revert state has no existing snapshot ref
**What goes wrong:** `revert` needs to store the current worktree state for `redo`. The current state may have uncommitted changes not captured in any turn ref. If `revert` only records `turns[last].sha`, `redo` restores to the last turn snapshot — not to the actual state before revert.
**Why it happens:** Turn refs are written by post-commit hook — only committed states have snapshot SHAs.
**How to avoid:** Call `snapshotWorktree()` at the start of `revert` to capture current state; store the resulting `commitSha` as `pre_revert_snapshot_sha` in the revert op. [ASSUMED: design decision]
**Warning signs:** `redo` appears to "lose" uncommitted work that existed before `revert`.

### Pitfall 6: gc session ordering — UUIDs are not time-ordered
**What goes wrong:** Session IDs are `crypto.randomUUID()` — random, no embedded timestamp. Sorting session IDs lexicographically does not give age order.
**Why it happens:** UUIDs v4 are random.
**How to avoid:** Sort sessions by the `creatordate` of their earliest turn ref (or by parsing `created` from the turn-1 snapshot commit message). Use `git for-each-ref --format='%(refname) %(creatordate:iso)' --sort=creatordate refs/git-turn/sessions/`. [VERIFIED: git for-each-ref creatordate tested locally]
**Warning signs:** gc deleting the wrong (newest) sessions instead of oldest.

### Pitfall 7: Test files run in parallel workers — process.chdir() must be per-test
**What goes wrong:** `process.chdir()` at module level in test files fails because the worker's initial cwd doesn't match the expected tmp dir path (macOS `/tmp` vs `/private/tmp` symlink resolution, or path created in a different context).
**Why it happens:** Node `--test` spawns test files as parallel worker threads. Module-level side effects execute in worker context.
**How to avoid:** Call `process.chdir(repoDir)` inside `beforeEach`, restore with `afterEach(() => process.chdir(origCwd))`. [VERIFIED: tested locally]
**Warning signs:** `chdir` calls fail with ENOENT, or git commands operate on wrong repo.

---

## Code Examples

### Test Helper: Temp Git Repo Setup/Teardown

Verified pattern for Node.js test files using built-in `node:test`:

```javascript
// Source: verified locally — Node v18.20.8
'use strict';
const { test, beforeEach, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const os = require('os');

function makeTestRepo() {
  const dir = mkdtempSync(join(os.tmpdir(), 'git-turn-test-'));
  function git(args, opts = {}) {
    return execFileSync('git', args, {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, HOME: dir },  // isolate git config
      ...opts,
    }).trim();
  }
  git(['init', '-q']);
  git(['config', 'user.email', 'test@test.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), 'test\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, git };
}

describe('diff command', () => {
  let repoDir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const { dir } = makeTestRepo();
    repoDir = dir;
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  test('diff N M shows changes between turns', () => {
    // ... test body using require('../commands/diff').run(args)
  });
});
```

### Format Blob Write Pattern

```javascript
// Source: verified locally — git hash-object -w --stdin via spawnSync
const { spawnSync } = require('child_process');
const { git } = require('../git');

function writeFormatBlob() {
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
  if (result.status !== 0) throw new Error('hash-object failed: ' + result.stderr);
  const blobSha = result.stdout.trim();
  git(['update-ref', 'refs/git-turn/format', blobSha]);
}
```

### GC Session Pruning Pattern

```javascript
// Source: design based on verified git for-each-ref creatordate behavior
function listSessionsByAge() {
  const { git, gitSafe } = require('../git');
  const prefix = 'refs/git-turn/sessions/';
  
  // Get all turn refs with creatordate, sorted oldest first
  const out = gitSafe([
    'for-each-ref',
    '--format=%(refname) %(creatordate:iso-strict)',
    '--sort=creatordate',
    prefix,
  ]);
  if (!out) return [];
  
  // Extract unique session IDs preserving oldest-first order
  const seen = new Set();
  const sessions = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const ref = line.split(' ')[0];
    const sessionId = ref.replace(prefix, '').split('/')[0];
    if (!seen.has(sessionId)) {
      seen.add(sessionId);
      sessions.push(sessionId);
    }
  }
  return sessions; // oldest first
}

// In gc.run():
function run(args) {
  const keepIdx = args.indexOf('--keep-sessions');
  const keepN = keepIdx !== -1 ? parseInt(args[keepIdx + 1], 10) : 10;
  
  const allSessions = listSessionsByAge(); // oldest first
  const toDelete = allSessions.slice(0, Math.max(0, allSessions.length - keepN));
  
  const currentSession = readSession();
  for (const sessionId of toDelete) {
    if (currentSession && sessionId === currentSession.session_id) continue; // never prune current
    const refs = listRefs(`refs/git-turn/sessions/${sessionId}/`);
    for (const { ref } of refs) deleteRef(ref);
    console.log(`Pruned session ${sessionId} (${refs.length} turns)`);
  }
  if (toDelete.length > 0) {
    console.log("Snapshot objects will be reclaimed on next 'git gc'");
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node --test <glob>` in npm script | `node --test` (no args, auto-discovery) | Node 18 | Avoids sh glob incompatibility |
| Manual tmp file for git stdin | `spawnSync(..., { input: data })` | Node 10+ | No temp file cleanup needed |

**Deprecated/outdated:**
- `node --test src/**/*.test.js` in package.json: The `**` glob is not supported by `/bin/sh`. Must change to `node --test` (auto-discovers from cwd). [VERIFIED: tested locally]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `revert` should call `snapshotWorktree()` before restoring, to give `redo` a concrete snapshot SHA to restore to | Pattern 3, Pitfall 5 | If wrong: `redo` could only restore to the last turn ref, losing uncommitted changes |
| A2 | Format blob JSON schema fields beyond `version` and `tool` (specifically `schema`, `ref_pattern`, `notes_ref`) | Pattern 6 | If wrong: Warren discovery code looks for different fields; easy to adjust |
| A3 | Op type name `'revert'` (not `'revert-to'`, `'restore'`, etc.) | Pattern 3 | Low risk — internal only; `revert` and `redo` must agree |
| A4 | `HOME: dir` in test git config prevents global gitconfig bleed | Test Helper example | If wrong: test git user config may inherit from developer's global config; low severity |

---

## Open Questions (RESOLVED)

1. **Format blob ref: `refs/git-turn/format` vs `refs/turns/format`**
   - What we know: Both pass `git check-ref-format`. The existing namespace is `refs/git-turn/`. Warren will read this ref.
   - What's unclear: Does Warren have a hardcoded expectation on the ref name? (Unlikely given D-11 says "Warren reads this; git-turn writes it" and the schema is TBD.)
   - Recommendation: Use `refs/git-turn/format` for namespace consistency. Document the chosen name so Warren can be coded to match.
   - RESOLVED: Use `refs/git-turn/format`. Stays in the existing `refs/git-turn/` namespace; `refs/turns/.format` is invalid per Pitfall 1 (dot-prefix); `refs/turns/format` is valid but inconsistent with the established namespace. All plans use `refs/git-turn/format`.

2. **Should `redo` be idempotent (write a `redo` op itself)?**
   - What we know: D-02 says LIFO redo only. If `redo` doesn't mark the revert op as consumed, calling `redo` twice would re-apply the same revert.
   - What's unclear: Is double-redo a hard error or a no-op?
   - Recommendation: `redo` writes a `redo` op after restoring; a subsequent `redo` finds no unredeemed `revert` op and errors with "nothing to redo". This requires the LIFO search to skip `revert` ops that already have a corresponding `redo` op — or simply mark them by writing a `redo` op with the same `revert_op_hash`.
   - RESOLVED: Yes — `redo` writes a `redo` op after restoring. LIFO search uses `session_id:turn_n` key matching to identify unredeemed reverts (not file hash). A subsequent `redo` finds no unredeemed revert op and fails with "nothing to redo" per D-02. Implemented in Plan 01-03 Task 2.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=18 | All commands, tests | ✓ | v18.20.8 | — |
| git CLI | All git operations | ✓ | 2.50.1 | — |
| `node:test` | Test suite | ✓ | Node 18 built-in | — |
| `node:assert` | Test assertions | ✓ | Node 18 built-in | — |

**Missing dependencies with no fallback:** none

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` built-in (v18.20.8) |
| Config file | none — auto-discovery from cwd |
| Quick run command | `node --test` |
| Full suite command | `node --test` |

**Package.json fix required:** Change `"test": "node --test src/**/*.test.js"` to `"test": "node --test"`. [VERIFIED: `**` glob not supported by /bin/sh; auto-discovery works correctly in Node 18]

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04 | `diff N M` diffs snapshot worktree-trees of turn N and M | unit | `node --test src/commands/diff.test.js` | Wave 0 |
| D-05 | `diff N` diffs turn N-1 vs N; turn 1 diffs vs empty tree | unit | `node --test src/commands/diff.test.js` | Wave 0 |
| D-01/D-03 | `revert N` restores worktree, HEAD unchanged, fails on branch mismatch | integration | `node --test src/commands/revert.test.js` | Wave 0 |
| D-02 | `redo` restores pre-revert state (LIFO), errors if no revert in log | integration | `node --test src/commands/revert.test.js` | Wave 0 |
| D-06/D-07 | `status` reports session ID, turns, branch, started, hook health | unit | `node --test src/commands/status.test.js` | Wave 0 |
| D-08/D-09/D-10 | `gc --keep-sessions N` prunes oldest sessions, prints gc hint | integration | `node --test src/commands/gc.test.js` | Wave 0 |
| D-11 | `init` writes format blob to `refs/git-turn/format` | integration | `node --test src/commands/init.test.js` | Wave 0 |

### Wave 0 Gaps
- [ ] `src/commands/diff.test.js` — covers D-04, D-05
- [ ] `src/commands/revert.test.js` — covers D-01, D-02, D-03
- [ ] `src/commands/status.test.js` — covers D-06, D-07
- [ ] `src/commands/gc.test.js` — covers D-08, D-09, D-10
- [ ] `src/commands/init.test.js` — covers D-11 (format blob write)
- [ ] `src/helpers/test-repo.js` — shared temp git repo helper (not a test file itself)

---

## Security Domain

This phase adds no authentication, network access, user input parsing beyond argv integers, or cryptography beyond what `crypto.randomUUID()` already provides. ASVS categories are not applicable. The primary security property to maintain is the existing rule: **no shell string interpolation in git calls** — all new commands must follow the `execFileSync('git', args[])` pattern enforced throughout the codebase.

---

## Sources

### Primary (HIGH confidence)
- Local codebase (`src/git.js`, `src/session.js`, `src/commands/*.js`, `src/hooks/post-commit.js`) — read in full
- Local verification: `git check-ref-format`, `git hash-object -w --stdin`, `git update-ref`, `git for-each-ref --sort=creatordate`, `git diff <commit> <commit>`, `git read-tree --reset -u` — all tested in temp repos
- Node.js v18 `node:test` runner — `before`, `after`, `beforeEach`, `afterEach`, `describe`, `test` all verified present; auto-discovery of `**/*.test.js` verified; parallel worker behavior verified

### Secondary (MEDIUM confidence)
- Node.js `--test` auto-discovery pattern — verified by running `node --test` in temp directory with nested `*.test.js` files

### Tertiary (LOW confidence — see Assumptions Log)
- Pre-revert snapshotting design for `redo` correctness — A1
- Format blob JSON schema fields beyond `version`/`tool` — A2

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all built-ins verified present
- Architecture: HIGH — all patterns verified against existing codebase and git behavior
- Pitfalls: HIGH — each pitfall verified by direct testing, not just training data
- Op log schema for revert/redo: MEDIUM — schema design is ASSUMED, consistent with existing pattern

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 (stable domain — git plumbing and Node built-ins are not fast-moving)

---
phase: 01-core-commands
reviewed: 2026-08-09T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/commands/diff.js
  - src/commands/diff.test.js
  - src/commands/gc.js
  - src/commands/gc.test.js
  - src/commands/init.js
  - src/commands/init.test.js
  - src/commands/redo.js
  - src/commands/redo.test.js
  - src/commands/revert.js
  - src/commands/revert.test.js
  - src/commands/status.js
  - src/commands/status.test.js
  - src/git.js
  - src/helpers/test-repo.js
findings:
  critical: 4
  warning: 4
  info: 1
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-09
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed all six commands (diff, gc, init, redo, revert, status), the core git abstraction layer, and the test helper. The commands themselves are lean and mostly correct. Four blockers were identified: a snapshot coverage gap that silently drops staged-but-uncommitted files, a re-init that silently creates a new session (destroying turn history), a corrupted undo stack when revert fails partway through, and a phantom import that signals an incomplete or abandoned refactor. Four warnings cover session-id mismatch in redo, duplicate git config entries on repeated init, silent error suppression in init, and Node module-cache coupling in tests.

---

## Critical Issues

### CR-01: snapshotWorktree silently drops staged-but-uncommitted new files

**File:** `src/git.js:74-98`
**Issue:** The snapshot builds a temp index by seeding from HEAD (`read-tree HEAD`), then adding untracked files via `ls-files --others --exclude-standard`, then running `git add -u`. Once a file is staged (`git add newfile.txt`) it is no longer "untracked" — `ls-files --others` excludes it. But it is also not in HEAD, so `read-tree HEAD` doesn't include it either. And `git add -u` only updates files already in the temp index. Result: any file staged but not yet committed is silently omitted from the snapshot. Turn snapshots taken during an in-progress commit are therefore incomplete.

**Fix:** After seeding and updating the temp index, copy staged entries from the real index for files not already in the temp index:
```js
// After git add -u — pick up staged-but-not-HEAD entries
git(['read-tree', '--index-output=' + tmpIndex, '--reset', '-i', 'HEAD'], { env: tmpEnv });
// Better: merge real index into temp index for staged new files
git(['read-tree', '-m', 'HEAD'], { env: tmpEnv });
// Or simplest: seed temp index from the real index, not just HEAD
// Replace: git(['read-tree', head], { env: tmpEnv })
// With:    git(['read-tree', '--empty'], { env: tmpEnv })
//          git(['read-tree', head], { env: tmpEnv })
// Then merge staged entries: duplicate real index into tmpEnv before add-u
```
The most direct fix: before the `write-tree` step, also add any files that appear in `git diff --cached --name-only` but not in HEAD:
```js
const staged = gitSafe(['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: root });
const stagedNew = staged ? staged.split('\n').filter(Boolean) : [];
if (stagedNew.length) {
  git(['add', '--', ...stagedNew], { env: tmpEnv, cwd: root });
}
```

---

### CR-02: re-running `git turn init` silently destroys the current session

**File:** `src/commands/init.js:21-67`
**Issue:** When the hook is already installed, the code prints "hook already installed" but does **not return**. Execution falls through to `ensureDirs()` and `newSession()` on lines 43–44, creating a brand-new session with a fresh session_id. All turn refs from the old session become unreferenced (orphaned). The user loses the entire turn history for the current session with no warning. The idempotency test (`assert.doesNotThrow`) only verifies no exception is thrown — it does not verify the session is unchanged.

**Fix:** Return early after the "already installed" message:
```js
if (existing.includes('git-turn')) {
  console.log('git turn: hook already installed');
  return; // <-- add this
}
```
Alternatively, check for an existing session and skip `newSession()` if one already exists.

---

### CR-03: phantom revert op written before restore, corrupting undo stack on branch mismatch

**File:** `src/commands/revert.js:27-39`
**Issue:** `writeOp('revert', ...)` is called on line 29 **before** `restoreSnapshot(...)` on line 39. When `restoreSnapshot` throws a branch-mismatch error, the revert op is already persisted in the op log but the worktree was never changed. A subsequent `git turn redo` call will find this unredeemed revert op, "restore" `pre_revert_snapshot_sha` (which equals the current state since no change was made), and mark the op consumed — effectively wasting a redo slot and masking the real undo history. The comment acknowledges the ordering but does not account for this failure mode.

**Fix:** Write the op only after a successful restore:
```js
// Pre-revert snapshot MUST happen before any restore so redo has a concrete SHA
const { commitSha: pre_revert_snapshot_sha } = snapshotWorktree({ ... });

// Restore first — throws on branch mismatch
restoreSnapshot(turn.sha, { branch: session.branch });

// Only write op if restore succeeded
writeOp('revert', {
  session_id: session.session_id,
  turn_n: N,
  snapshot_sha: turn.sha,
  pre_revert_snapshot_sha,
  branch: session.branch,
});
```

---

### CR-04: phantom import of non-existent `execFileSyncWithTmpIndex` from `child_process`

**File:** `src/git.js:6`
**Issue:** `execFileSyncWithTmpIndex` is destructured from Node's built-in `child_process` module, which has no such export. The value will always be `undefined`. It is never called anywhere in the file. This is either a leftover from a planned refactor that was abandoned, or a mistake. Because the real index-manipulation path (the `tmpIndex` approach in `snapshotWorktree`) is implemented manually via shell env vars rather than through this function, its absence is currently harmless — but the import is a dead symbol that signals unfinished work and would cause a silent failure if ever called.

**Fix:** Remove the unused binding:
```js
// Before
const { execFileSync, execFileSyncWithTmpIndex } = require('child_process');

// After
const { execFileSync } = require('child_process');
```

---

## Warnings

### WR-01: redo session-id key mismatch allows double-redo after session re-init

**File:** `src/commands/redo.js:16-22`
**Issue:** The redemption check builds keys as `redo_op.session_id + ':' + redo_op.revert_turn_n` and matches them against `revert_op.session_id + ':' + revert_op.turn_n`. A redo op stores `session_id: session.session_id` (the session active at time of redo), while a revert op stores `session_id: session.session_id` (the session active at time of revert). If the user runs `git turn init` between a revert and redo (creating a new session), the two session IDs differ, the redemption key never matches, and the revert op is considered "unredeemed" forever — allowing unlimited redo calls from the same op. The D-02 test passes only because tests do not re-init between revert and redo.

**Fix:** Store the revert op's `session_id` on the redo op so the redemption key uses consistent identifiers:
```js
// In redo.js writeOp call:
writeOp('redo', {
  session_id: lastRevert.session_id, // use revert's session_id, not current
  revert_turn_n: lastRevert.turn_n,
  restored_snapshot_sha: lastRevert.pre_revert_snapshot_sha,
});
```

---

### WR-02: `git config --add log.showSignature false` appends duplicates on repeated init

**File:** `src/commands/init.js:40`
**Issue:** `git config --add` appends a new value rather than setting. Every call to `git turn init` (even when the hook is already installed — see CR-02) appends another `log.showSignature = false` entry to the repo config. After N inits there are N duplicate entries. The `--add` flag should be `--replace-all` or plain set (`git config log.showSignature false`).

**Fix:**
```js
// Before
git(['config', '--add', 'log.showSignature', 'false']);

// After
git(['config', 'log.showSignature', 'false']);
```

---

### WR-03: format blob write failure in `init` is silently ignored

**File:** `src/commands/init.js:56-65`
**Issue:** When `spawnSync('git', ['hash-object', ...])` fails (`result.status !== 0`), the code skips writing the format blob and `refs/git-turn/format` is not created — but no error or warning is printed. Tools that rely on format discovery (e.g., remote readers expecting `refs/git-turn/format`) will fail silently. `result.stderr` is never inspected.

**Fix:**
```js
if (result.status === 0) {
  const blobSha = result.stdout.trim();
  git(['update-ref', 'refs/git-turn/format', blobSha]);
  console.log('✓ Wrote format discovery blob: refs/git-turn/format');
} else {
  console.error('git turn: warning: failed to write format discovery blob:', result.stderr.trim());
}
```

---

### WR-04: `require()` inside test bodies couples tests via Node module cache

**File:** `src/commands/diff.test.js:63`, `src/commands/diff.test.js:79`, `src/commands/diff.test.js:98`, `src/commands/redo.test.js:47`, `src/commands/redo.test.js:54`, `src/commands/revert.test.js:49`, and similar patterns across test files
**Issue:** Several tests call `require('./module')` inside the test body. Node caches modules after the first `require`. When tests run in the same process (which `node:test` does by default), later tests get the same cached module instance as earlier ones. If a module captures state at load time (e.g., via `readSession()` at module scope), changes made in `beforeEach` (like `process.chdir`) after the first require are invisible to the cached module. This can produce false passes or false failures depending on test execution order.

**Fix:** Hoist all `require` calls to the top of the describe block or use `beforeEach` to clear the require cache entry if the module captures cwd-dependent state:
```js
// At top of test file (or describe block), require once:
const { run } = require('./diff');

// Or if module-level state is truly a concern, clear cache in beforeEach:
beforeEach(() => {
  delete require.cache[require.resolve('./diff')];
});
```

---

## Info

### IN-01: `makeTestRepo` creates initial branch on ambiguous default name

**File:** `src/helpers/test-repo.js:27`
**Issue:** `git init -q` without `--initial-branch` creates a branch named whatever the system default is (`master` or `main` depending on git config). Tests that assert on branch names may behave differently across developer machines or CI environments. The test in `revert.test.js:74` uses `git checkout -b other` to switch away, which is safe, but any assertion against a literal branch name elsewhere would be fragile.

**Fix:** Pin the initial branch name explicitly:
```js
git(['init', '-q', '--initial-branch=main']);
```

---

_Reviewed: 2026-08-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

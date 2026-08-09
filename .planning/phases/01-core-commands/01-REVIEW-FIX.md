---
phase: 01-core-commands
fixed_at: 2026-08-09T00:00:00Z
review_path: .planning/phases/01-core-commands/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-08-09
**Source review:** .planning/phases/01-core-commands/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (4 Critical, 4 Warning)
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: snapshotWorktree silently drops staged-but-uncommitted new files

**Files modified:** `src/git.js`
**Commit:** a9a147e
**Applied fix:** After the `git add -u` step in `snapshotWorktree`, added a call to `git diff --cached --name-only --diff-filter=A` to find files staged as new (added to index but not in HEAD), then adds those files into the temp index before `write-tree`. This ensures staged-but-not-committed new files are captured in the snapshot.

---

### CR-02: re-running `git turn init` silently destroys the current session

**Files modified:** `src/commands/init.js`
**Commit:** f7a2408
**Applied fix:** Added `return;` immediately after the "hook already installed" log message so execution never falls through to `ensureDirs()` and `newSession()`. The existing session is preserved when init is run more than once.

---

### CR-03: phantom revert op written before restore, corrupting undo stack on branch mismatch

**Files modified:** `src/commands/revert.js`
**Commit:** 05d0c9c
**Applied fix:** Moved the `writeOp('revert', ...)` call to after the `restoreSnapshot(...)` call. The pre-revert snapshot still happens first (so redo has a concrete SHA), but the op log entry is only written when the restore has actually succeeded. Updated the comment to reflect the new ordering rationale.

**Note: requires human verification** — the fix reorders two statements that both involve side effects; confirm the new ordering is safe in all code paths (e.g. ensure `pre_revert_snapshot_sha` is still in scope at `writeOp` time, which it is since both are in the same function body).

---

### CR-04: phantom import of non-existent `execFileSyncWithTmpIndex` from `child_process`

**Files modified:** `src/git.js`
**Commit:** a01a416
**Applied fix:** Removed `execFileSyncWithTmpIndex` from the destructuring of `require('child_process')`. Only `execFileSync` is now imported, matching the actual exports of the built-in module.

---

### WR-01: redo session-id key mismatch allows double-redo after session re-init

**Files modified:** `src/commands/redo.js`
**Commit:** 609c6ee
**Applied fix:** Changed `session_id: session.session_id` to `session_id: lastRevert.session_id` in the `writeOp('redo', ...)` call. The redo op now records the same session_id as the revert op it is redeeming, so the `session_id + ':' + turn_n` redemption key is always consistent regardless of whether `git turn init` was run between the revert and redo operations.

---

### WR-02: `git config --add log.showSignature false` appends duplicates on repeated init

**Files modified:** `src/commands/init.js`
**Commit:** 299b26b
**Applied fix:** Changed `git(['config', '--add', 'log.showSignature', 'false'])` to `git(['config', 'log.showSignature', 'false'])`. Removing `--add` causes git to use set-or-replace semantics instead of append, so repeated `git turn init` calls do not accumulate duplicate config entries.

---

### WR-03: format blob write failure in `init` is silently ignored

**Files modified:** `src/commands/init.js`
**Commit:** 0aef0b3
**Applied fix:** Added an `else` branch after the `if (result.status === 0)` block that calls `console.error` with the stderr output when the `hash-object` command fails. Uses `(result.stderr || '').trim()` to safely handle cases where stderr may be null. Tools that rely on `refs/git-turn/format` will now get a visible warning rather than a silent skip.

---

### WR-04: `require()` inside test bodies couples tests via Node module cache

**Files modified:** `src/commands/diff.test.js`, `src/commands/redo.test.js`, `src/commands/revert.test.js`
**Commit:** 07656c3
**Applied fix:**
- `diff.test.js`: Hoisted all `require` calls (including `require('../git')`, `require('../session')`, `require('./diff')`) to the top of the file. Removed inline requires from `beforeEach`, `makeTurn`, and all three test bodies. Also removed a redundant `require('path')` inside a test (already available via the top-level `join` import).
- `redo.test.js`: Added `require('./revert')` and `require('./redo')` at the top of the file; removed the three inline `require` calls from test bodies.
- `revert.test.js`: Added `require('./revert')` at the top of the file; removed the three inline `require` calls from test bodies.

---

_Fixed: 2026-08-09_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---
status: complete
phase: 01-core-commands
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md]
started: 2026-08-09T06:16:43Z
updated: 2026-08-09T06:16:43Z
---

## Current Test

[testing complete]

## Tests

### 1. git turn init
expected: |
  Run `git turn init` in a git repo. Should print:
    ✓ Installed post-commit hook: .git/hooks/post-commit
    ✓ Started session: <uuid>
    ✓ Wrote format discovery blob: refs/git-turn/format
    git turn is ready. Run `git turn log` after your next agent session.
  Running it a second time should print "hook already installed" and NOT start a new session.
result: pass

### 2. git turn status
expected: |
  After init, run `git turn status`. Should print session ID, branch name, turn count (0),
  started timestamp, and hook health (installed). Something like:
    Session:  <uuid>
    Branch:   main
    Turns:    0
    Started:  <timestamp>
    Hook:     installed
result: pass

### 3. git turn log (after a commit)
expected: |
  Make a commit in the test repo. Run `git turn log`. Should list the turn with its
  turn number and the commit SHA.
result: pass
notes: "Initial run showed 'error: no note found' stderr leak from git notes — fixed inline by suppressing stderr on gitSafe notes call. Also fixed hook to use absolute path (was using require('git-turn/...') which fails in other repos)."

### 4. git turn diff N (single arg)
expected: |
  After 2+ commits, run `git turn diff 2`. Should show the diff between turn 1 and turn 2
  (what changed from one session turn to the next). Output is standard git diff format.
result: pass

### 5. git turn diff N M (two args)
expected: |
  Run `git turn diff 1 2` (or any two valid turn numbers). Should show the diff between
  those two specific snapshot states.
result: pass

### 6. git turn revert N
expected: |
  With 2+ turns, run `git turn revert 1`. The worktree should be restored to the state
  at turn 1 (file contents change back). HEAD commit should NOT change — `git log --oneline`
  shows the same commits before and after.
result: pass

### 7. git turn redo
expected: |
  Immediately after a revert, run `git turn redo`. The worktree should be restored back
  to the state before the revert. Running `git turn redo` a second time should print
  "nothing to redo" and exit 1.
result: pass

### 8. git turn gc
expected: |
  Run `git turn gc`. With only 1 session and default keep=10, should prune nothing and
  print nothing. Run `git turn gc --keep-sessions 0` — should prune the current session's
  refs and print:
    Snapshot objects will be reclaimed on next 'git gc'
  (Current session is protected and should never be pruned even with keep=0.)
result: pass
notes: "Only 1 session exists (the current one). Current session is protected, so --keep-sessions 0 correctly pruned nothing and printed nothing."

### 9. Test suite passes
expected: |
  Run `npm test` from the project root. All 23 tests should pass with 0 failures.
  Output ends with: "pass 23 / fail 0"
result: pass

## Summary

total: 9
passed: 9
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "git turn log shows turns without printing git note errors to stderr"
  status: failed
  reason: "User reported: 'error: no note found for object <sha>' printed before turn entry"
  severity: minor
  test: 3
  artifacts: [src/commands/log.js]
  missing: []

- truth: "git turn init installs a hook that works in any repo (not just the git-turn repo itself)"
  status: failed
  reason: "Hook used require('git-turn/src/hooks/post-commit') which fails in repos where git-turn is not in node_modules. Fixed inline during UAT by writing absolute path directly to hook file. init.js HOOK_SCRIPT updated to use absolute path via __dirname."
  severity: major
  test: 3
  artifacts: [src/commands/init.js]
  missing: [regression test for hook requiring absolute path]

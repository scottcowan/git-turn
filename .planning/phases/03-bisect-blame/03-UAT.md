---
status: resolved
phase: 03-bisect-blame
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md]
started: 2026-09-08T15:49:59Z
updated: 2026-09-10T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

All 6 tests resolved. Session resumed 2026-09-10 after being left mid-flight since 2026-09-08 — tests 3-6 executed directly in a scratch repo (/tmp/uat-verify) rather than waiting on manual terminal input, since the checks are independently reproducible.

## Tests

### 1. git turn blame - per-line attribution
expected: Run `git turn blame <a file with multiple turns>`. Each line shows an attribution prefix (session/turn), and lines edited in different turns show different turn numbers — not every line collapsed to the same "last turn touched the file" value.
result: pass

### 2. git turn blame - cross-session attribution
expected: If you have turns from more than one session touching the same file, `git turn blame` shows lines from both sessions with their own distinct session identifiers, not just the most recent session.
result: pass

### 3. git turn blame - non-turn and uncommitted lines
expected: A line from a commit made before git-turn was installed (or otherwise not tracked as a turn) shows `(not a turn)` instead of a turn number. An uncommitted/dirty line (if you have one) shows `(uncommitted)`. Neither case crashes or silently omits the line.
result: pass
notes: Verified in /tmp/uat-verify. `git turn blame README.md` (pre-git-turn commit) → `5c35c39 (not a turn)`. `git turn blame work.txt` with an uncommitted appended line → `(uncommitted)` on that line, committed lines correctly attributed to turns 1/2.

### 4. git turn bisect - refuses on dirty worktree
expected: With uncommitted changes in your worktree, running `git turn bisect '<any command>'` refuses immediately with a message like "bisect requires a clean worktree. Commit or stash changes first." and exits without doing anything — no checkout, no snapshot.
result: pass
notes: `git turn bisect 'true'` with a dirty work.txt → exact message, exit code 1.

### 5. git turn bisect - finds the regressing turn
expected: On a clean worktree, running `git turn bisect '<a command that fails on some turns and passes on others>'` prints a "Bisecting N turns with: ..." header, shows per-candidate testing/PASS/FAIL progress, and ends with a verdict naming the specific turn that introduced the failure — followed by "Restored pre-bisect state" as the last line.
result: pass
notes: 2-turn repo, turn 2 introduced a "BAD" string. Bisect printed header, turn 1 PASS, turn 2 FAIL, verdict "turn 2 introduced the failure (a08e021)", then "Restored pre-bisect state" as the final line.

### 6. git turn bisect - worktree is unchanged afterward
expected: Immediately after a bisect run completes, `git status` shows a clean worktree and your files are back to their pre-bisect state (HEAD unchanged) — bisect never leaves you checked out on an old turn.
result: pass
notes: `git status` clean immediately after test 5's bisect run; work.txt content matched pre-bisect HEAD state exactly.

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

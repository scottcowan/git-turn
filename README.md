# git-turn

When an AI agent session breaks your code, `git turn` tells you which turn did it and lets you restore to just before.

Works with any agent that makes git commits: Claude Code, Cursor, Aider, opencode.

## How it works

Your post-commit hook snapshots the full worktree after each commit — tracked files, untracked files, staged changes. Each snapshot becomes a "turn". You can diff turns, revert to any of them, or bisect to find which one introduced a bug.

Turns group commits by session automatically. You don't tag anything or change how you work.

## Install

```sh
npm install -g git-turn
```

Then run this once in each repo you want to track:

```sh
git turn init
```

That installs the post-commit hook. Your next agent session starts capturing turns on every commit.

**Bare repos with git worktrees:** `git turn init` works in any worktree — it finds the shared hooks directory automatically via `git rev-parse --git-common-dir`. Run it once from any worktree and the hook fires for all of them.

**Repos using Husky, lefthook, or another `core.hooksPath` manager:** `git turn init` detects `core.hooksPath` and installs there instead of the default hooks dir — a hook installed at the default location is silently never invoked once `core.hooksPath` is set elsewhere. If a hook file already exists at that path (e.g. Husky's own `post-commit`), git-turn appends its own call rather than overwriting it. Run `git turn status` afterward — it reports `shadowed by core.hooksPath=...` if it ever finds a stale git-turn hook sitting at the default location where git will never read it.

## Commands

```
git turn log                     List turns in the current session
git turn status                  Session ID, turn count, hook health
git turn diff <N>                Diff turn N-1 vs turn N
git turn diff <N> <M>            Diff any two turns
git turn show <N>                Full diff for turn N
git turn blame <file>            Which turn last touched each line
git turn bisect <cmd>            Binary-search turns for the one that broke <cmd>
git turn revert <N>              Restore worktree to turn N state
git turn redo                    Undo the last revert
git turn gc [--keep-sessions N]  Prune old session refs (default: keep 10)
```

## Example

```sh
$ git turn log
Session: f17a78b9

  turn  1  872024f  feat: add auth middleware      8 files changed
  turn  2  ba2bdc4  feat: add user model           3 files changed
  turn  3  7552932  fix: patch validation bug      1 file changed

$ git turn diff 2 3
diff --git a/src/auth/middleware.js b/src/auth/middleware.js
...

$ git turn revert 2
Reverted to turn 2

$ git turn redo
Redo complete (restored state before revert to turn 2)
```

## Blame and bisect

```sh
$ git turn blame src/auth.js
Blame: src/auth.js

f17a78b9:1                  1) const jwt = require('jsonwebtoken');
f17a78b9:2                  2) function sign(payload) {
abc1234 (not a turn)        3)   return jwt.sign(payload, secret);

$ git turn bisect 'npm test'
Bisecting 7 turns with: npm test
  turn  3  ba2bdc4  testing...
  PASS
  turn  5  7552932  testing...
  FAIL
turn 5 introduced the failure (7552932)
Restored pre-bisect state
```

Attribution spans every session in the repo, not just the current one — a line committed in an earlier session still shows that session's turn label. Lines from commits made before `git turn init` show as `(not a turn)`; uncommitted lines show as `(uncommitted)`.

`bisect` requires a clean worktree and refuses to start otherwise. `<cmd>` runs through your own shell with your own privileges — exactly as `git bisect run <cmd>` does — so only bisect commands you'd be comfortable running directly yourself.

## Storage

Everything lives in your git repo. No server, no external service.

- `refs/git-turn/sessions/{id}/turn-{N}` — snapshot refs
- `.git/git-turn/ops/` — operation log for revert/redo
- `refs/git-turn/format` — discovery blob for tooling

## Requirements

Node.js 22+. Git 2.x.

## License

MIT

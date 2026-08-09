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

## Commands

```
git turn log                     List turns in the current session
git turn status                  Session ID, turn count, hook health
git turn diff <N>                Diff turn N-1 vs turn N
git turn diff <N> <M>            Diff any two turns
git turn show <N>                Full diff for turn N
git turn revert <N>              Restore worktree to turn N state
git turn redo                    Undo the last revert
git turn gc [--keep-sessions N]  Prune old session refs (default: keep 10)
```

Coming in v0.2: `git turn blame <file>`, `git turn bisect <cmd>`

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

## Storage

Everything lives in your git repo. No server, no external service.

- `refs/git-turn/sessions/{id}/turn-{N}` — snapshot refs
- `.git/git-turn/ops/` — operation log for revert/redo
- `refs/git-turn/format` — discovery blob for tooling

## Requirements

Node.js 18+. Git 2.x.

## License

MIT

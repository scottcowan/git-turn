# git-turn

A git extension for auditing AI agent sessions.

Groups commits into **turns** — one turn per agent response — and lets you diff, blame, bisect, and revert at turn granularity instead of commit granularity.

## What it does

Every time an AI agent (Claude Code, Cursor, Aider, opencode, etc.) makes commits in response to a prompt, `git-turn` captures that as a single auditable unit:

- **a ref** at the last commit of the turn — shows in `git log --decorate`
- **a note** on that commit — stores the prompt, model, latency
- **a snapshot** — dangling commit with full worktree state (including uncommitted work)

## Install

```bash
npm install -g git-turn
git turn init        # installs post-commit hook in current repo
```

## Usage

```bash
git turn log                  # list all turns this session
git turn show 3               # full diff for turn 3, including prompt
git turn diff 1 5             # what changed between turn 1 and 5
git turn blame src/auth.py    # which turn last touched each line
git turn bisect "pytest"      # binary search — which turn broke a command
git turn revert 3             # restore worktree to turn 3 state
git turn redo                 # undo the revert
```

## How it looks in git log

After `git turn init`, turn boundaries appear as decorations in your normal git history:

```
* f1c9a0 (HEAD, main, git-turn/turn-4) add rate limiting
* d7e3b1 (git-turn/turn-3) fix session handling
* b8d4e2                   fix auth edge case
* a4f2c1 (git-turn/turn-2) extract to utils module
```

Turn 3 had two commits. Turn 2 had one. `git turn show 3` diffs across both.

## Design

- **No server required** — everything lives in your local git repo under `refs/git-turn/`
- **Works with any harness** — post-commit hook fires regardless of which agent made the commits
- **MCP addon** — optional Claude Code integration so the agent can query history and revert directly in conversation
- **Warren integration** — optional `git turn branch --from 3` provisions a new workspace from a turn snapshot via [warren](https://github.com/scottcowan/warren)

## Storage

```
.git/git-turn/
  session.json    — current session_id, turn_n, preexisting_untracked[]
  ops/            — operation log (before/after ref snapshots, for undo/redo)

refs/git-turn/
  sessions/{id}/turn-{N}   — dangling snapshot commit per turn
```

Turn refs show in `git log --decorate` and survive branch deletion and merging. They're pruned by `git turn gc` or `git gc` if no refs point at them.

## Prior art

- [pi-rewind](https://github.com/arpagon/pi-rewind) — dangling commit-tree snapshots, two-tree model
- [copilot-timeline-session](https://github.com/mmcs-work/copilot-timeline-session) — per-turn commits, untracked exclusion
- [Jujutsu](https://github.com/jj-vcs/jj) — content-addressed operation log
test
test
test

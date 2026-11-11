# git-turn

When an AI agent session breaks your code, `git turn` tells you which turn did it and lets you restore to just before.

Works with any agent that makes git commits: Claude Code, Cursor, Aider, opencode.

## How it works

Your post-commit hook snapshots the full worktree after each commit — tracked files, untracked files, staged changes. Each snapshot becomes a "turn". You can diff turns, revert to any of them, or bisect to find which one introduced a bug.

Turns group commits by session automatically. You don't tag anything or change how you work.

## Install

```sh
git clone https://github.com/scottcowan/git-turn.git
cd git-turn
npm install
npm link
```

`npm link` puts `git-turn` on your `PATH`, so `git turn <command>` works. (git-turn is not published to the npm registry yet.)

Then run this once in each repo you want to track:

```sh
git turn init
```

That installs the post-commit hook. Your next agent session starts capturing turns on every commit.

**Bare repos with git worktrees:** `git turn init` works in any worktree — it finds the shared hooks directory automatically via `git rev-parse --git-common-dir`. Run it once from any worktree and the hook fires for all of them.

**Repos using Husky, lefthook, or another `core.hooksPath` manager:** `git turn init` detects `core.hooksPath` and installs there instead of the default hooks dir — a hook installed at the default location is silently never invoked once `core.hooksPath` is set elsewhere. If a hook file already exists at that path (e.g. Husky's own `post-commit`), git-turn appends its own call rather than overwriting it. Run `git turn status` afterward — it reports `shadowed by core.hooksPath=...` if it ever finds a stale git-turn hook sitting at the default location where git will never read it.

## Commands

```
git turn log [--json]            List turns in the current session
git turn status                  Session ID, turn count, hook health
git turn diff <N> [--plain] [--json]       Diff turn N-1 vs turn N
git turn diff <N> <M> [--plain] [--json]   Diff any two turns
git turn show <N> [--plain] [--json]       Full diff for turn N
git turn blame <file> [--json]   Which turn last touched each line
git turn bisect <cmd>            Binary-search turns for the one that broke <cmd>
git turn heatmap                 Calendar heatmap of turn activity across all sessions
git turn revert <N>              Restore worktree to turn N state
git turn redo                    Undo the last revert
git turn gc [--keep-sessions N]  Prune old session refs (default: keep 10)
git turn gc --purge-notes        Permanently purge old note history from refs/notes/git-turn
git turn redact <N>              Scrub a turn's captured prompt after the fact
git turn cost [--all] [--json]   Token usage and estimated cost for the current (or all) sessions
git turn session new [--from <session_id>:<turn_n>]  Start a session, optionally forked from a specific turn
git turn session list            List every session, with turn counts and fork lineage
git turn export [--since <ref>] [--output <path>]    Bundle git-turn refs for handoff to another repo
```

`log`, `show`, `diff`, `blame` and `cost` also accept `--json` for structured output (and print `{"error": "..."}` on stdout with exit 1 on failure); `diff` and `show` accept `--plain` to get the old `git diff`-passthrough output instead of the rich default below. See AGENTS.md for the full JSON shapes.

## Example

```sh
$ git turn log
Session: f17a78b9

  turn  1  872024f  feat: add auth middleware      8 files changed
  turn  2  ba2bdc4  feat: add user model           3 files changed
  turn  3  7552932  fix: patch validation bug      1 file changed

$ git turn diff 2 3
Added 1 / removed 1

diff --git a/src/auth/middleware.js b/src/auth/middleware.js
@@ -10,3 +10,3 @@
10   function auth(req, res, next) {
   -   const token = req.header('authorization');
11 +   const token = req.headers.authorization;
12   next();

$ git turn log --json
[{"turn":1,"sha":"872024f...","snapshot_sha":"a1b2c3...","subject":"feat: add auth middleware","files_changed":8,"insertions":120,"deletions":4}, ...]

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

## Sessions and lineage

```sh
$ git turn session list
* f17a78b9-d92e-497a-823a-fc8ce61c8cea  (26 turns)

$ git turn session new --from f17a78b9-d92e-497a-823a-fc8ce61c8cea:12
Started session: 3f332ce6-48ce-4a33-94ae-39827ce2032a
Forked from: f17a78b9-d92e-497a-823a-fc8ce61c8cea turn 12

$ git turn session list
  f17a78b9-d92e-497a-823a-fc8ce61c8cea  (26 turns)
* 3f332ce6-48ce-4a33-94ae-39827ce2032a  (0 turns)  forked from f17a78b9-d92e-497a-823a-fc8ce61c8cea turn 12
```

`session new --from <session_id>:<turn_n>` records where a session branched from as durable metadata (`refs/git-turn/sessions/{id}/meta`) — unlike the active session's `session.json`, which gets overwritten by the next `session new`, this survives so `session list` can always show the fork lineage.

## Exporting turn history

```sh
$ git turn export --since v1.2.0 --output handoff.bundle
✓ Exported 14 ref(s) to handoff.bundle
  (incremental — excludes everything reachable from v1.2.0)
```

`export` bundles just the git-turn ref namespace (session/turn refs, the notes ref, the format blob) into a standard `git bundle` — hand it to another clone without granting access to the rest of the repo. `--since <ref>` makes it incremental, excluding everything already reachable from that ref. The receiving side pulls it in with `git fetch handoff.bundle 'refs/git-turn/*:refs/git-turn/*' 'refs/notes/git-turn:refs/notes/git-turn'` (or `git bundle unbundle`).

## Remediating a leaked secret

If a captured prompt (via `git turn record-prompt`) ends up containing a secret that the
built-in scanner missed, remediation is a two-step procedure:

```sh
$ git turn redact 3
Turn 3: prompt redacted
Note history still contains the old blob — run `git turn gc --purge-notes` to remove it.

$ git turn gc --purge-notes
git turn gc: this permanently deletes ALL unreachable objects in this
repository (git gc --prune=now is not scoped to notes) — including any
dangling commits with no ref protecting them, and discards note history for
EVERY commit's note, not just the one that leaked.
Purged notes history for refs/notes/git-turn (old tip abc1234 -> new tip def5678).
Old note blobs are now unreachable and have been pruned.
```

1. **`git turn redact <N>`** replaces that turn's captured `prompt` field with `[REDACTED]`,
   leaving `model`/`usage`/`latency_ms`/`tool_summary` intact. It runs immediately with no
   confirmation prompt. **This step is necessary but not sufficient** — the pre-redaction note
   blob is still present and reachable in the git object store after this step alone.
2. **`git turn gc --purge-notes`** is what actually removes the old blob. It collapses
   `refs/notes/git-turn` to a single parentless commit holding the current (redacted) tree,
   expires that ref's reflog, then runs `git gc --prune=now`.

Three facts about this procedure were verified empirically (running real git commands against
throwaway repos) and each contradicts what you might otherwise assume:

- **Reflog expiry plus `git gc --prune=now` alone does NOT remove the old note blob.** Every
  `git notes add -f` commits a new notes-tree commit with the previous notes commit as its
  *parent*, so the old version stays reachable as an ordinary ancestor of the ref tip — reflog
  expiry has no effect on ancestor reachability. The history-collapse step (a fresh, parentless
  `commit-tree`) is what actually severs that chain and is what makes the purge work.
- **`git gc --prune=now` is repository-wide**, not scoped to `refs/notes/git-turn`. It also
  permanently deletes any other unreachable object in the repo not protected by a ref or reflog
  — git provides no ref-scoped object pruning. This is unavoidable, not a bug.
- **The purge discards note history for EVERY commit's note, not only the one that leaked.**
  There is no way to purge one commit's note history in isolation while preserving another's.

`git filter-repo` and BFG Repo-Cleaner are **not** alternatives here — neither tool has
documented handling of the `refs/notes/*` ref namespace.

## MCP server

`git turn mcp` starts a stdio [MCP](https://modelcontextprotocol.io) server so an MCP client can read your turn history. It is scoped to the repo it is started in and exposes five **read-only** tools:

`git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost`

Each returns the same text its CLI command prints (always without color). Failures such as an out-of-range turn come back as tool errors, not crashes. Destructive and write commands (`revert`, `bisect`, `redact`, `record-prompt`) are deliberately not exposed.

Run `git turn init` in the repo first, then register it with Claude Code from inside that repo:

```sh
claude mcp add git-turn -- git turn mcp
```

The MCP server needs the npm dependencies installed (`npm install` in the git-turn checkout); every other command has no runtime dependencies.

## Storage

Everything lives in your git repo. No server, no external service.

- `refs/git-turn/sessions/{id}/turn-{N}` — snapshot refs
- `refs/git-turn/sessions/{id}/meta` — durable per-session metadata (fork lineage), survives after the session is no longer active
- `refs/notes/git-turn` — per-commit metadata (`{session_id, turn_n, snapshot_sha, ts}`)
- `.git/git-turn/ops/` — operation log for revert/redo
- `refs/git-turn/format` — discovery blob for tooling

## Requirements

Node.js 22+. Git 2.x.

## License

MIT — see [LICENSE](LICENSE).

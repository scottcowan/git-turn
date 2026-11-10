---
status: complete
phase: 10-end-to-end-verification-with-a-real-mcp-client
source: [10-01-PLAN.md]
requirement: VERIFY-04
started: 2026-11-10T16:17:03Z
updated: 2026-11-10T16:42:05Z
---

## Method (read this first)

The plan specified an interactive Claude Code session driven by the user. The user instead directed the executor to "test it out yourself", so the check was run as **two headless Claude Code sessions** (`claude -p --output-format stream-json --verbose`, model sonnet) against the three registered servers. The client is still the real Claude Code launching `git turn mcp` over stdio, which is what VERIFY-04 requires. Differences from the interactive checklist, stated so nothing is overclaimed:

- **Evidence is the raw `tool_result` blocks and the session `init` event** (server status and tool list), not a model paraphrase and not the `/mcp` UI. Tool access was restricted with `--allowedTools` to the `git-turn` and `git-turn-fixture` servers, plus a Bash rule limited to the two `mv` commands of step 8.
- **"Still connected" checks (steps 7, 8)** are evidenced by a later successful call to the same server inside the same session, not by re-opening `/mcp`.
- **"Same server process recovered" (step 8)** is inferred from both calls happening inside one headless session, which spawns each server once. A process id was not captured.
- **Step 9** records the server status from the `init` event (`failed`). The `/mcp` stderr/log view was not captured; the startup refusal text and exit code come from Task 1's direct run.
- Run 1 covered steps 1-7. Run 2 covered step 8.

## Setup

Preflight (Task 1):
- `git turn status`: Session `af84657e-5bcd-4326-beca-8796253bb7d6`, Branch `main`, Turns `43`, Hook `installed`.
- Binary the client launches: `/Users/scowan/Projects/scottcowan/git-turn/bin/git-turn` (this checkout).
- `git turn show 39 --plain` and `git turn show 38 --plain` exit 0. `@modelcontextprotocol/server/stdio` resolves, no `npm install` needed.
- No prior `git-turn*` registration, no `.mcp.json`.

Fixtures (under `/tmp/git-turn-phase10`): `uninit` (`git init` only) and `fixture` (`git turn init` plus one commit, session `d95438ca-36d4-427d-ac10-d7166581bf20`, turn 1 `fixture turn 1`).

Startup refusal in the never-initialized repo, `git -C /tmp/git-turn-phase10/uninit turn mcp </dev/null`: stderr ``git turn: not initialized. Run `git turn init` first.``, exit code `1`.

Registrations (all `-s local`, from the repo root):
```
claude mcp add -s local git-turn -- git turn mcp
claude mcp add -s local git-turn-fixture -- git -C /tmp/git-turn-phase10/fixture turn mcp
claude mcp add -s local git-turn-uninit -- git -C /tmp/git-turn-phase10/uninit turn mcp
```

`claude mcp list` after registration:
```
git-turn: git turn mcp - ✔ Connected
git-turn-fixture: git -C /tmp/git-turn-phase10/fixture turn mcp - ✔ Connected
git-turn-uninit: git -C /tmp/git-turn-phase10/uninit turn mcp - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
```

## Tests

### 1. Connection and tool list
maps_to: SC1, 08-UAT-1
expected: git-turn and git-turn-fixture connected, git-turn-uninit failed; git-turn lists exactly the 5 tools.
observed: `init` event in both runs: `git-turn connected`, `git-turn-fixture connected`, `git-turn-uninit failed`. Tools for `git-turn`: `git_turn_blame`, `git_turn_cost`, `git_turn_diff`, `git_turn_log`, `git_turn_show` (exactly 5; the fixture server lists the same 5).
result: pass

### 2. git_turn_log
maps_to: SC1
expected: No error; one line per turn from `turn 1`; last turn number equals a fresh `git turn status` `Turns:` and the latest commit subject.
observed: `is_error` not set. Result starts `Session: af84657e-...` then `turn  1  d57f717  docs(phase-7): complete phase execution ...`. Last line `turn 43  3ec25e7  docs(phase-10): begin phase execution`. A fresh `git turn status` at check time reported `Turns: 43`.
result: pass

### 3. git_turn_show 39
maps_to: SC1
expected: No error; identifies turn 39; `Added N / removed M` line; the 10-CONTEXT.md diff; no raw escape codes.
observed: `is_error` not set. Result begins `Turn 39  094e9a7  06/11/2026, 17:23:27` then `Added 154 / removed 0`, then the `10-CONTEXT.md` new-file diff. 0 escape (0x1b) bytes in the body.
result: pass

### 4. git_turn_diff 39 to 40
maps_to: SC1
expected: No error; summary line; diff of `.planning/STATE.md`.
observed: `is_error` not set. Result begins `Added 8 / removed 8` then `diff --git a/.planning/STATE.md b/.planning/STATE.md`. 0 escape bytes.
result: pass

### 5. git_turn_blame AGENTS.md
maps_to: SC1
expected: No error; lines labeled `<8-hex>:<N>` or `<sha7> (not a turn)`.
observed: `is_error` not set. Result starts `Blame: AGENTS.md`, lines labeled `f17a78b9:28`, `af84657e:20`, and so on (110 labeled lines matched).
result: pass

### 6. git_turn_cost
maps_to: SC1
expected: No error flag; output matches `git turn cost` run in a terminal.
observed: `is_error` not set. Result starts `Session: af84657e-...` followed by the cost table (pricing present in cache, no fetch failure). Compared with `git turn cost` stdout: identical, ignoring only the trailing newline. The CLI's `Fetching pricing data...` text goes to stderr and is not part of stdout.
result: pass

### 7. Out-of-range turn, then an unrelated call
maps_to: SC2, SC3
expected: Tool error with exactly `git turn: turn 999 not found`; server stays up; a following blame call succeeds.
observed: `git_turn_show {"turn": 999}` returned `is_error = true` with the text `git turn: turn 999 not found`. The next call in the same session, `git_turn_blame {"file": "package.json"}`, returned `is_error` unset and `Blame: package.json` with attribution lines (`d142ced (not a turn)` and `af84657e:23`). The session ended `success` with all 7 calls answered.
result: pass

### 8. Uninitialized repo while the server is running
maps_to: SC2, SC3
expected: With `session.json` moved aside, `git_turn_log` on the fixture server returns exactly ``git turn: not initialized. Run `git turn init` first.`` as a tool error; after restoring it, the same call works; an unrelated call on the main server succeeds.
observed (run 2, one session):
1. `git_turn_log` on git-turn-fixture: `is_error` unset, `turn  1  b020a92  fixture turn 1`.
2. Bash `mv .../fixture/.git/git-turn/session.json .../session.json.bak`: ok.
3. `git_turn_log` on git-turn-fixture: `is_error = true`, text ``git turn: not initialized. Run `git turn init` first.``.
4. Bash `mv .../session.json.bak .../session.json`: ok.
5. `git_turn_log` on git-turn-fixture: `is_error` unset, `turn  1` is back.
6. `git_turn_diff {"turn": 38}` on git-turn: `is_error` unset, `Added 123 / removed 17`.
Final result `success`, 8 turns, no server dropped. `session.json` confirmed restored afterwards.
result: pass

### 9. Uninitialized repo at server startup
maps_to: SC2
expected: git-turn-uninit shown as failed with no tools; the other two unaffected.
observed: `claude mcp list` showed `✘ Failed to connect — CONNECTION_CLOSED: Connection closed`; the `init` event in both runs showed `git-turn-uninit failed` with `git-turn` and `git-turn-fixture` connected, and no `git-turn-uninit` tools in the tool list. The refusal message and exit code 1 are from the Task 1 direct run (Setup). The `/mcp` UI stderr view was not captured.
result: pass

## Success Criteria

| ROADMAP criterion | Steps | Result |
|---|---|---|
| SC1: Claude Code, connected to `git turn mcp`, calls all 5 tools against a real session with real turns | 1-6 | PASS |
| SC2: out-of-range turn or uninitialized repo surfaces as a recoverable tool error, not a crash or dropped connection | 7, 8, 9 | PASS |
| SC3: after a tool error, an unrelated call in the same session still succeeds | follow-up calls in 7 and 8 | PASS |

Note on SC2: a never-initialized repo shows up in a real client as a **failed server connection at startup** (step 9), by design, because `git turn mcp` exits 1 before serving. The tool-level recoverable uninitialized-repo error is demonstrated by step 8 (`session.json` removed under a running server). The out-of-range turn error is step 7.

## Phase 8 UAT item

08-HUMAN-UAT.md test 1 (register with a real MCP client and confirm it connects) is closed by step 1 above and the Setup `claude mcp list` output.

## Cleanup

```
claude mcp remove -s local git-turn          -> Removed MCP server git-turn from local config
claude mcp remove -s local git-turn-fixture  -> Removed MCP server git-turn-fixture from local config
claude mcp remove -s local git-turn-uninit   -> Removed MCP server git-turn-uninit from local config
rm -rf /tmp/git-turn-phase10
```
Confirmed afterwards: no `git-turn*` line in `claude mcp list`, `/tmp/git-turn-phase10` gone, no `.mcp.json` in the repo. Re-add the server permanently with `claude mcp add git-turn -- git turn mcp`.

## Summary

total: 9
passed: 9
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None

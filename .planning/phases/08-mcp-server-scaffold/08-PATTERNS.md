# Phase 8: MCP Server Scaffold - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 6 (2 new source, 2 new/extended test, 2 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `src/commands/mcp.js` | controller (CLI entry, `run(args)` only) | event-driven (long-lived stdio listener, no compute/return) | `src/commands/status.js` (bootstrap/validate shape) + `src/commands/bisect.js` (long-running process + signal handling) | role-match (composite — no single exact analog exists for a non-exiting server command) |
| `src/mcp/server.js` (optional split) | factory/service | request-response (per MCP spec, deferred to Phase 9) | `src/blame-util.js` (pure factory/helper module separated from its CLI-facing `commands/*.js` caller) | partial match (closest existing factory/helper split) |
| `src/commands/mcp.test.js` | test | event-driven / subprocess integration | `src/commands/compute-purity.test.js` (fixture + `spawn`-style child process conventions) + `src/commands/bisect.test.js` (signal-handling assertions) | role-match (no prior test spawns a long-lived, stdin-interactive child — new pattern, composed from two analogs) |
| `src/commands/cost.js` (modified, COST-01) | service/compute (CRUD-ish: read notes, aggregate) | batch (cross-session aggregation) | itself, prior version; cross-session loop modeled on `src/commands/blame.js` / `src/commands/bisect.js` / `src/commands/heatmap.js`'s existing `listAllTurns({ noCache })` usage | exact (same helper already proven 3x) |
| `src/commands/cost.test.js` (modified, COST-01) | test | batch | itself, prior version — extend with two-session fixture pattern already used via `startSession()`/`makeTurn()` | exact |
| `bin/git-turn` (modified) | router/dispatch | request-response | itself, prior version — `COMMANDS` array + `--help` text block | exact |

## Pattern Assignments

### `src/commands/mcp.js` (controller, event-driven, zero compute())

**Analog 1 — bootstrap/validate order:** `src/commands/status.js`

**Imports pattern** (lines 1-6):
```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { gitDir, hooksDir, gitSafe } = require('../git');
const { readSession, listTurns } = require('../session');
```
→ For `mcp.js`, the equivalent is:
```javascript
'use strict';
const { readSession } = require('../session');
const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
```

**Validate-then-fail-loudly pattern** (`src/commands/status.js` lines 36-41):
```javascript
function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }
  ...
```
This is the **exact D-03 string** (RESEARCH.md confirms verbatim reuse) and the exact "validate first, exit before doing anything else" shape `mcp.js` must follow — `readSession()` must run and fail *before* `serveStdio()` is ever called, mirroring how `status.js` fails before touching `listTurns()`/`checkHookStatus()`.

**Analog 2 — long-running process + signal handling:** `src/commands/bisect.js`

**Signal registration/cleanup pattern** (lines 68-78, 134-139 in `src/commands/bisect.js`):
```javascript
// Signal safety extends the restore guarantee beyond the `finally` below —
// spawnSync is blocking, so a Ctrl-C during the child's run must not leave
// a candidate tree checked out over the user's work. Named handlers so
// they can be removed in the finally without leaking listeners across
// repeated invocations in one process (the test suite does exactly this).
const onSignal = signal => {
  restorePreBisectState(pre_bisect_snapshot_sha, session.branch);
  process.stderr.write(`git turn: aborted by ${signal}, restored pre-bisect state\n`);
  process.exit(130);
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
```
This establishes the project's one existing convention for `process.on('SIGINT', ...)`. Adapt for `mcp.js` (D-02: silent exit 0, no stderr write, no `process.exit(130)` — `handle.close()` already resolves cleanly):
```javascript
process.on('SIGINT', () => { void handle.close(); }); // D-02: silent, no stderr, no process.exit
```
Key divergence from the `bisect.js` analog: `bisect.js`'s handler is a **named function removed in a `finally` block** because `bisectCore()` returns and the process continues running other code afterward (test suite re-invokes it repeatedly). `mcp.js`'s handler has no matching teardown/removal step because the process is expected to exit once `handle.close()` resolves — do not copy the `removeListener` cleanup, only the registration idiom.

**Full composed shape** (from RESEARCH.md Pattern 2, already codebase-verified against `status.js`'s validate-first convention and `package.json`'s existing `require('../../package.json').version` access pattern used elsewhere — e.g. no other command reads `package.json` directly today, so this is a new but trivial access):
```javascript
'use strict';
const { readSession } = require('../session');
const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.'); // D-03, verbatim — copy from status.js:39
    process.exit(1);
    return;
  }

  const repoPath = process.cwd(); // captured ONCE — MCP-02

  const handle = serveStdio(() => new McpServer({
    name: 'git-turn',
    version: require('../../package.json').version,
  }));

  process.stderr.write(`git turn mcp: server started, scoped to ${repoPath}\n`); // D-01

  process.on('SIGINT', () => { void handle.close(); }); // D-02
}

module.exports = { run };
```

**No `compute()` export** — deliberate exception to the compute/run split every other `src/commands/*.js` file follows (see `cost.js`'s `module.exports = { run, compute, ... }` below for the convention being deviated from). Document this exception in the plan rather than inventing a no-op `compute()`.

---

### `src/mcp/server.js` (optional split — factory/service)

**Analog:** `src/blame-util.js`'s module shape — a pure helper module with no CLI/`run()` surface, imported by `src/commands/*.js` callers (`blame.js`, `bisect.js`, `cost.js` all `require('../blame-util')`).

**Module export pattern** (`src/blame-util.js`, shape only):
```javascript
'use strict';
// ... pure functions ...
module.exports = { listAllTurns, listAllTurnsFromRefs, parseSnapshotMessage, /* ... */ };
```
If the split is taken, `src/mcp/server.js` should export a single factory function only (no `run`, no process-lifecycle code — that stays in `mcp.js`, matching how `blame-util.js` has zero `process.exit`/`process.on` calls and leaves all CLI-facing concerns to its callers):
```javascript
'use strict';
const { McpServer } = require('@modelcontextprotocol/server');

function createServer() {
  return new McpServer({ name: 'git-turn', version: require('../../package.json').version });
  // Phase 9 adds server.registerTool(...) calls here.
}

module.exports = { createServer };
```
`mcp.js` then calls `serveStdio(createServer)` instead of inlining the factory.

---

### `src/commands/mcp.test.js` (test, subprocess integration — new pattern)

**Analog 1 — fixture/chdir conventions:** `src/commands/compute-purity.test.js`

**Fixture setup pattern** (lines 1-39):
```javascript
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

const BIN_PATH = join(__dirname, '..', '..', 'bin', 'git-turn');

describe('...', () => {
  let dir, origCwd, origHome, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;

    const { startSession, makeTurn } = require('../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });
});
```
For `mcp.test.js`, per RESEARCH.md's Pitfall 2, pass `cwd: dir` directly to `spawn()` rather than relying on `process.chdir()` in the test process — `mcp.js` must be exercised as a real subprocess (it never returns), so `execFileSync`/`spawnSync` (blocking) are wrong; use `child_process.spawn` with `cwd: dir`, matching `BIN_PATH` resolution above but invoked non-blockingly:
```javascript
const { spawn } = require('child_process');
const child = spawn(process.execPath, [BIN_PATH, 'mcp'], {
  cwd: dir,
  env: { ...process.env, HOME: dir },
});
```

**Analog 2 — signal-handling assertions:** `src/commands/bisect.test.js`

**SIGINT listener-count assertion pattern** (lines 273-286):
```javascript
test('SIGINT listener count is higher during the search than before, and restored after bisectCore returns', () => {
  const before = process.listenerCount('SIGINT');
  ...
  during = process.listenerCount('SIGINT');
  ...
  assert.equal(process.listenerCount('SIGINT'), before);
});
```
`mcp.test.js`'s analog assertion is subprocess-level, not in-process listener counting (since `mcp.js` is spawned as a child, not required in-process) — send `child.kill('SIGINT')` and assert `child.on('exit', (code, signal) => {...})` fires with code 0 and no stderr beyond the D-01 line, per RESEARCH.md's Wave 0 Gaps section (exact JSON-RPC handshake payload and bounded-timeout safety-net pattern already specified there verbatim — reuse that spec, no need to re-derive it here).

**No existing analog for stdin-interactive long-lived subprocess tests** — this is new test infrastructure for the repo; RESEARCH.md's "Wave 0 Gaps" section already gives the concrete JSON-RPC request/response shapes and the `setTimeout` + `child.kill('SIGKILL')` safety-net idiom to use. Treat that section as the primary spec; the two analogs above only supply the surrounding fixture/chdir/signal-assertion conventions.

---

### `src/commands/cost.js` (modified, COST-01 — service/batch)

**Analog:** itself (prior version) + the established `listAllTurns({ noCache })` convention already used identically in three other commands.

**Existing cross-session usage to copy verbatim** (`src/commands/bisect.js`, relevant line):
```javascript
blameUtil.listAllTurns({ noCache })
```
(also used at `blame.js:34` and `heatmap.js:330` per RESEARCH.md/CONTEXT.md — do not reinvent.)

**Current single-session loop being generalized** (`src/commands/cost.js` lines 85-99, 121-166):
```javascript
const allSessions = args.includes('--all');   // parsed, line 86 — currently unused, this is COST-01's bug
const wantJson = args.includes('--json');
...
const turns = listTurns(session.session_id);  // single-session only
...
lines.push(`Session: ${session.session_id}\n`);
lines.push(`  ${'Turn'.padEnd(5)}  ${'Model'.padEnd(30)}  ${'Input'.padStart(8)}  ${'Output'.padStart(8)}  ${'Cost'.padStart(10)}`);
lines.push(`  ${'-'.repeat(5)}  ${'-'.repeat(30)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(10)}`);

for (const { turn_n, sha } of turns) {
  const { headSha } = parseSnapshotMessage(sha);   // <-- do NOT call this on listAllTurns() results, see Pitfall 4
  const head = headSha || sha;
  ...
}
```

**Required refactor shape** (per RESEARCH.md's Code Examples section, already validated against this exact file):
```javascript
if (allSessions) {
  const { listAllTurns } = require('../blame-util');
  const turns = listAllTurns({ noCache: args.includes('--no-cache') });

  const bySession = new Map();
  for (const t of turns) {
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, []);
    bySession.get(t.session_id).push(t);
  }
  // Loop bySession, reusing the existing per-session rendering body above,
  // but reading t.head_sha directly — never re-call parseSnapshotMessage(t.snapshot_sha).
  // Append a grand-total line after the last per-session block (D-04).
}
```

**Critical pitfall (do not copy the wrong field):** `listTurns()` (session.js) returns `{turn_n, ref, sha}` — raw snapshot sha, resolved per-turn via `parseSnapshotMessage(sha)` inside the loop (current code, line 126). `listAllTurns()` (blame-util.js) already returns `head_sha` pre-resolved (`src/blame-util.js` lines 53-62, shown above) — calling `parseSnapshotMessage()` again on its output is the "two sha-resolution helpers" bug class the research explicitly flags. Use `t.head_sha` directly in the `--all` branch; leave the non-`--all` branch's `parseSnapshotMessage(sha)` call untouched.

**Error-handling / run() wrapper to leave untouched** (`src/commands/cost.js` lines 200-212):
```javascript
async function run(args) {
  try {
    console.log(await compute(args, { stderr: (s) => process.stderr.write(s) }));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
      return;
    }
    console.error(e.message);
    process.exit(1);
  }
}
module.exports = { run, compute, lookupPrice, computeCost };
```
No change needed here — COST-01 is entirely inside `compute()`'s `--all` branch.

---

### `src/commands/cost.test.js` (modified, COST-01 — test)

**Analog:** itself (prior version) + `src/commands/compute-purity.test.js`'s two-session fixture convention.

**Existing fixture pattern to extend** (`src/commands/cost.test.js` lines 1-33):
```javascript
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

describe('cost command', () => {
  let dir, origCwd, origHome, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;

    const { startSession } = require('../helpers/turn-fixtures');
    session = startSession();
  });
  ...
  function seedFakePricing(dir, modelKey, priceEntry) { ... }
});
```
For `--all` test cases, call `startSession()` a second time (per RESEARCH.md's Wave 0 Gaps: "two sessions in one fixture repo ... called twice to produce two distinct `session_id`s") and `makeTurn(session, content, repo.git)` for each, then assert:
- plain-text output contains two `Session: <id>` blocks in turn order plus a grand-total line
- `--json --all` output's `turns` array contains entries from both sessions (session_id already present per Phase 7 JSON shape — no restructuring needed there)

---

### `bin/git-turn` (modified)

**Analog:** itself (prior version) — no new pattern, pure additive edit.

**Current `COMMANDS` array and dispatch** (lines 8, 53-56):
```javascript
const COMMANDS = ['init', 'log', 'show', 'diff', 'blame', 'bisect', 'heatmap', 'revert', 'redo', 'branch', 'status', 'gc', 'session', 'cost', 'export', 'record-prompt', 'redact'];
...
const result = require(cmdPath).run(args);
if (result && typeof result.then === 'function') {
  result.catch(err => { console.error(`git turn: ${err.message}`); process.exit(1); });
}
```
Add `'mcp'` to the array. **No dispatch change required** — `mcp.js`'s `run(args)` returns `undefined` (not a promise, per `serveStdio()`'s synchronous contract), so the existing thenable check simply skips, exactly as RESEARCH.md's Pattern 3 confirms.

**Current `--help` block** (lines 13-37) — add one line in the same style as the existing `cost` line:
```
  cost [--all] [--json]   Show token usage and cost for current session
```
→ new line, same alignment convention:
```
  mcp                     Start a stdio MCP server scoped to the current repo
```

---

## Shared Patterns

### "Not initialized" error (D-03)
**Source:** `src/commands/status.js` lines 38-41 (also `src/commands/cost.js` line 82, `src/commands/record-prompt.js` lines 28-31 — same string repeated verbatim across every command)
**Apply to:** `src/commands/mcp.js`
```javascript
console.error('git turn: not initialized. Run `git turn init` first.');
process.exit(1);
```
Reuse this exact string — do not introduce a variant or paraphrase.

### Signal handling (`process.on('SIGINT', ...)`)
**Source:** `src/commands/bisect.js` lines 68-78
**Apply to:** `src/commands/mcp.js` (adapted — no `process.exit()` call, no stderr write per D-02; this is the one place in the codebase that registers a SIGINT handler today, so it is the only available analog even though its cleanup semantics differ)

### Cross-session turn enumeration
**Source:** `src/blame-util.js`'s `listAllTurns({ noCache })`, already consumed identically by `src/commands/blame.js`, `src/commands/bisect.js`, `src/commands/heatmap.js`
**Apply to:** `src/commands/cost.js`'s new `--all` branch — do not write a second implementation.

### `module.exports` shape for `src/commands/*.js`
**Source:** every existing file in `src/commands/` exports at minimum `{ run }`, most also export `compute` (the Phase 7 compute/run split — see `cost.js` line 214: `module.exports = { run, compute, lookupPrice, computeCost };`)
**Apply to:** `src/commands/mcp.js` is the deliberate exception — export `{ run }` only, with a comment explaining why no `compute()` exists (nothing to compute; the long-lived server itself is the "work"). Call this out explicitly in the plan so it isn't flagged as a missed convention during review.

### Test fixture bootstrap (`makeTestRepo` + `startSession`/`makeTurn`)
**Source:** `src/helpers/test-repo.js`'s `makeTestRepo()` and `src/helpers/turn-fixtures.js`'s `startSession()`/`makeTurn()`, used identically across every `*.test.js` file in `src/commands/`
**Apply to:** both `src/commands/mcp.test.js` and the extended `src/commands/cost.test.js`

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/commands/mcp.test.js`'s stdin-interactive JSON-RPC handshake harness | test | event-driven (long-lived subprocess, bidirectional stdio) | No existing test in the repo spawns a long-running child and exchanges newline-framed JSON-RPC messages over its stdin/stdout while it stays alive; every existing `*.test.js` either uses blocking `execFileSync`/`spawnSync` (process runs to completion) or calls `compute()`/`run()` in-process. RESEARCH.md's "Wave 0 Gaps" section supplies a concrete spec (exact JSON-RPC payloads, timeout/kill safety net) to use in place of a codebase analog. |

## Metadata

**Analog search scope:** `src/commands/*.js`, `src/commands/*.test.js`, `src/blame-util.js`, `src/session.js`, `src/git.js`, `src/helpers/*.js`, `bin/git-turn`, `package.json`
**Files scanned:** 24 command files + test counterparts, plus `bin/git-turn`, `src/blame-util.js`, `src/commands/status.js`, `src/commands/cost.js`, `src/commands/bisect.js`, `src/commands/record-prompt.js`, `src/commands/compute-purity.test.js`, `src/helpers/test-repo.js`, `src/helpers/turn-fixtures.js`, `package.json`
**Pattern extraction date:** 2026-10-21

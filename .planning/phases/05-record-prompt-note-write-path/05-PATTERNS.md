# Phase 5: record-prompt Note-Write Path - Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 4 (1 new command, 1 new test, 2 modified modules) + 1 registration edit
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `src/commands/record-prompt.js` | controller (CLI command) | request-response (stdin JSON in, note+cache write out) | `src/commands/status.js` (module shape) + `src/hooks/post-commit.js` (note-write call site) | role-match (no other stdin-reading writer command exists yet) |
| `src/record-prompt.test.js` | test | request-response / CRUD | `src/commands/status.test.js` (fixture setup) + `src/redact.test.js` (assertion style for redaction) | role-match |
| `src/git.js` → `updateNote()` | utility (git plumbing) | CRUD (read-merge-write) | `addNote`/`getNote` in the same file (lines 178-185) | exact — same file, same role, extending the pair |
| `src/cache.js` → migration + `updatePromptFields()` | model/service (SQLite schema + narrow update) | CRUD | `upsertTurn()` in the same file (lines 63-120) + `openDb()` (lines 21-55) | exact — same file, same role |
| `bin/git-turn` (register command) | route/config | request-response (dispatch table) | Existing `COMMANDS` array + `--help` block (the `heatmap` addition pattern from Phase 03.1) | exact |

## Pattern Assignments

### `src/commands/record-prompt.js` (controller, request-response)

**Analogs:** `src/commands/status.js` (module shape, session-not-initialized guard), `src/hooks/post-commit.js` (note payload construction, cache best-effort write), `src/blame-util.js` (turn resolution)

**Module shape / imports pattern** — copy exactly from `src/commands/status.js` lines 1-6, 36-41:
```javascript
'use strict';

const { readSession, listTurns, NOTES_REF } = require('../session');
// ... plus this phase's new pieces:
const { updateNote } = require('../git');
const { parseSnapshotMessage } = require('../blame-util');
const { redact } = require('../redact');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }
  // ...
}

module.exports = { run };
```
Every command file in `src/commands/` follows this exact shape: `'use strict'` header, plain `function run(args) {...}`, single `module.exports = { run }`, no class, no default export. `record-prompt.js` should be synchronous (no `async function run`) — the only async command in the codebase is `cost.js`, which is the deliberate outlier (network pricing fetch); this command has no I/O that requires it.

**Turn resolution pattern** — copy from `src/blame-util.js` lines 28-37 (`parseSnapshotMessage`) combined with `session.js` lines 107-116 (`listTurns`):
```javascript
const turns = listTurns(session.session_id);
if (turns.length === 0) {
  console.error('git turn: no turns yet this session. Make a commit first.');
  process.exit(1);
}
const latest = turns[turns.length - 1]; // listTurns() already sorts ascending by turn_n
const { headSha } = parseSnapshotMessage(latest.sha);
if (!headSha) {
  console.error('git turn: could not resolve head commit for the latest turn');
  process.exit(1);
}
```
This is the "never bare HEAD" pattern already used by `show.js`/`log.js` — `record-prompt.js` must not call `headSha()` from `src/git.js` (that resolves *current* HEAD at invocation time, not the target turn's HEAD).

**Note read-merge-write call site** — modeled on how `src/hooks/post-commit.js` (lines 48-55) constructs and writes the note payload, but replacing the blind `addNote()` call with the new `updateNote()` merge wrapper:
```javascript
const patched = updateNote(NOTES_REF, headSha, existing => ({
  ...existing,
  ...(payload.prompt !== undefined && { prompt: payload.prompt }),
  ...(payload.model !== undefined && { model: payload.model }),
  ...(payload.latency_ms !== undefined && { latency_ms: payload.latency_ms }),
  ...(payload.usage !== undefined && { usage: payload.usage }),
  ...(payload.tool_summary !== undefined && { tool_summary: payload.tool_summary }),
}));
```
Critical: `post-commit.js` line 55 (`addNote(NOTES_REF, head, notePayload)`) is a **blind overwrite** and must NOT be copied verbatim into `record-prompt.js` — that is exactly Pitfall 1 from RESEARCH.md. Only `updateNote()` may write the note from this command.

**Cache best-effort write pattern** — copy the try/catch-never-throws shape from `src/hooks/post-commit.js` lines 60-82:
```javascript
try {
  const { updatePromptFields } = require('../cache');
  updatePromptFields(session.session_id, latest.turn_n, {
    prompt: payload.prompt, model: payload.model, latencyMs: payload.latency_ms,
    usage: payload.usage, toolSummary: payload.tool_summary,
  });
} catch {}
```

**Error handling pattern** — every command in this codebase (verified across `status.js`, and RESEARCH.md's grep of 10+ files) uses the identical convention: `console.error('git turn: <message>')` to stderr followed by `process.exit(1)`. No exceptions found. `status.js` lines 38-41 is the canonical example:
```javascript
if (!session) {
  console.error('git turn: not initialized. Run `git turn init` first.');
  process.exit(1);
}
```
Apply this same convention to: empty/missing stdin, malformed JSON, non-string `prompt`, non-object `usage`, no turns yet.

**Redaction call site** — copy from `src/redact.js` module header (lines 18-19) and `redact()`'s exact signature (line 77, module export line 103):
```javascript
// redact() returns { text, count } — call it on the RAW string field before
// any JSON.stringify of the merged payload (Pitfall 3: scanning escaped
// \n sequences breaks multi-line PEM detection).
if (payload.prompt !== undefined) {
  if (typeof payload.prompt !== 'string') {
    console.error('git turn: prompt must be a string');
    process.exit(1);
  }
  const { text, count } = redact(payload.prompt);
  payload.prompt = text;
  if (count > 0) {
    process.stderr.write(`git turn: redacted ${count} potential secret(s) from prompt\n`);
  }
}
```
This defends WR-01 (`redact()` throws on non-string input, per Phase 4 review) — the type check must happen before the call, never after.

---

### `src/git.js` → new `updateNote(ref, commitSha, patchFn, opts)` (utility, CRUD)

**Analog:** `addNote`/`getNote` in the same file, lines 178-185:
```javascript
// Write a git note on a commit
function addNote(ref, commitSha, message) {
  git(['notes', `--ref=${ref}`, 'add', '-f', '-m', message, commitSha]);
}

// Read a git note
function getNote(ref, commitSha) {
  return gitSafe(['notes', `--ref=${ref}`, 'show', commitSha]);
}
```
`updateNote()` must be added directly below this pair (same file, same section, per the "belongs next to addNote/getNote — git plumbing, not command logic" architecture note) and must be added to the `module.exports` block at the bottom of the file (lines 187-193) alongside `addNote, getNote`.

**Core pattern** (bounded read-compare-retry, from RESEARCH.md Focus Q1, already fully specified and verified against this codebase's `addNote`/`getNote` signatures):
```javascript
function updateNote(ref, commitSha, patchFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const before = getNote(ref, commitSha);
    let existing = {};
    if (before) {
      try { existing = JSON.parse(before); } catch { existing = {}; }
    }
    const patched = patchFn(existing);
    const patchedJSON = JSON.stringify(patched);

    const justBeforeWrite = getNote(ref, commitSha);
    if (justBeforeWrite !== before) {
      if (attempt === maxRetries) {
        throw new Error(`updateNote: note for ${commitSha} changed concurrently, giving up after ${maxRetries} retries`);
      }
      continue;
    }
    addNote(ref, commitSha, patchedJSON);
    return patched;
  }
}
```
`patchFn` must be pure/side-effect-free — it may run more than once on retry.

---

### `src/cache.js` → schema migration + `updatePromptFields()` (model, CRUD)

**Analog:** `upsertTurn()` (lines 63-120) for the column-list-extension pattern; `openDb()` (lines 21-55) for where migration must run.

**Migration placement** — must go inside `openDb()` (lines 21-55), immediately after the `CREATE TABLE IF NOT EXISTS turns` block ends and before `CREATE INDEX` (i.e., inside the string template at the point after line 41's closing `);` of the turns table, still within the same `_db.exec(...)` template or as a separate `_db.exec()` call right after) — never after the `if (_db) return _db;` early-return guard (Pitfall 4), and never gated behind a first-call-only flag.

```javascript
function migrateSchema(db) {
  const migrations = [
    'ALTER TABLE turns ADD COLUMN usage TEXT',
    'ALTER TABLE turns ADD COLUMN tool_summary TEXT',
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}
```
This mirrors the existing catch-and-ignore idiom already used in `src/hooks/post-commit.js` line 82 (`} catch {}`) — guarded, not silent-on-real-errors.

**`upsertTurn()` column-list extension** — copy the exact pattern of `prompt`/`model`/`latency_ms` at lines 65-67 and 89-106:
```javascript
// Existing (lines 65-67):
const prompt = meta?.prompt || null;
const model = meta?.model || null;
const latency_ms = meta?.latency_ms || null;
// ADD alongside:
const usage = meta?.usage ? JSON.stringify(meta.usage) : null;
const tool_summary = meta?.tool_summary ? JSON.stringify(meta.tool_summary) : null;
```
Then extend both the `INSERT INTO turns (...)` column list and the `ON CONFLICT ... DO UPDATE SET` clause (lines 89-104) with `usage, tool_summary` exactly as `prompt, model, latency_ms` are already present, and extend the `.run(...)` positional args (line 105-106) to pass `usage, tool_summary` at the end.

**New `updatePromptFields()`** — narrow UPDATE, no numstat recompute (unlike `upsertTurn`, which always recomputes diff stats). This is a genuinely new pattern in this file (no existing narrow-UPDATE analog), but follows the same `db.prepare(...).run(...)` idiom used throughout (e.g. `getTurns`, line 208-209; `getTurnFiles`, line 221-223):
```javascript
function updatePromptFields(sessionId, turnN, { prompt, model, latencyMs, usage, toolSummary } = {}) {
  const db = openDb();
  db.prepare(`
    UPDATE turns SET
      prompt        = COALESCE(?, prompt),
      model         = COALESCE(?, model),
      latency_ms    = COALESCE(?, latency_ms),
      usage         = COALESCE(?, usage),
      tool_summary  = COALESCE(?, tool_summary)
    WHERE session_id = ? AND turn_n = ?
  `).run(
    prompt ?? null, model ?? null, latencyMs ?? null,
    usage ? JSON.stringify(usage) : null,
    toolSummary ? JSON.stringify(toolSummary) : null,
    sessionId, turnN
  );
}
```
Add `updatePromptFields` to the `module.exports` block at the bottom of the file (line 237), alongside the existing `openDb, closeDb, rebuild, ensureCache, insertTurn, getTurns, getAllTurns, getTurnFiles, getTurnsForFile` list.

---

### `bin/git-turn` (route/config, request-response)

**Analog:** The existing `COMMANDS` array and `--help` template literal — the exact two-edit pattern already used for every prior command addition (e.g. `heatmap` in Phase 03.1).

**Registration edit 1** (line 8) — add to the array:
```javascript
const COMMANDS = ['init', 'log', 'show', 'diff', 'blame', 'bisect', 'heatmap', 'revert', 'redo', 'branch', 'status', 'gc', 'session', 'cost', 'export', 'record-prompt'];
```

**Registration edit 2** (inside the `--help` template literal, lines 13-31) — add one line, matching the existing one-line-per-command alignment style (e.g. line 29's `cost` entry):
```
  cost                    Show token usage and cost for current session
  record-prompt           Attach prompt/model/usage/latency metadata to the latest turn (JSON on stdin)
  export [--since <ref>] [--output <path>]  Bundle git-turn refs for handoff to another repo
```
No other changes needed — `bin/git-turn`'s dispatcher (lines 40-50) already generically `require()`s any `src/commands/<cmd>.js` and calls `.run(args)`; it also already handles a Promise-returning `run()` (lines 48-50) for `cost.js`'s sake, so `record-prompt.js`'s synchronous `run()` needs no special-casing there.

---

### `src/record-prompt.test.js` (test, request-response/CRUD)

**Analogs:** `src/commands/status.test.js` (fixture setup, `captureStatus()`-style stdout capture) + `src/redact.test.js` (assertion style for redaction counts/behavior) + `src/helpers/turn-fixtures.js` (turn/session fixture builder) + `src/helpers/test-repo.js` (`makeTestRepo()`).

**Fixture setup pattern** — copy `beforeEach`/`afterEach` shape from `src/commands/status.test.js` lines 9-28:
```javascript
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

describe('record-prompt command', () => {
  let dir, origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    const { ensureDirs, newSession } = require('../session');
    ensureDirs();
    newSession();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

**Turn-fixture creation** — use `src/helpers/turn-fixtures.js`'s `makeTurn(session, content, git)` (lines 32-44) to create a committed turn (with the hook's `session_id`/`turn_n`/`snapshot_sha`/`ts` note fields already simulated via `snapshotMessage()`'s `head`/`branch`/`created` lines) before invoking `record-prompt.run([])` against it — this is the exact fixture used by `heatmap.test.js`/other command tests needing a real turn to target, and it's the direct way to set up the "hook fields already exist, record-prompt must not clobber them" scenario central to Pitfall 1's regression test.

**Stdin-injection pattern for tests** — no existing analog reads `process.stdin` (RESEARCH.md confirms zero grep hits), so tests must mock `fs.readFileSync` for fd `0` or monkeypatch `record-prompt.js`'s internal `readStdinSync()`. Recommended approach, consistent with `status.test.js`'s `console.log`-swap style (lines 34-42):
```javascript
function runWithStdin(jsonPayload) {
  const origRead = require('fs').readFileSync;
  require('fs').readFileSync = (fd, enc) => {
    if (fd === 0) return JSON.stringify(jsonPayload);
    return origRead(fd, enc);
  };
  try {
    return require('./record-prompt').run([]);
  } finally {
    require('fs').readFileSync = origRead;
  }
}
```

**Redaction assertion style** — copy from `src/redact.test.js` lines 8-13 (assert `count` and `!text.includes(secret)` / `text.includes('[REDACTED]')`), applied end-to-end: seed a `prompt` containing a known secret pattern (e.g. an AWS key fixture, same literal used in `redact.test.js` line 9), call `record-prompt`, then read the note back via `getNote()` and assert the secret is absent and `[REDACTED]` is present.

**Merge-preservation regression test** (Pitfall 1's explicit defense, per RESEARCH.md line 438) — assert that after calling `record-prompt`, the note's `session_id`/`turn_n`/`snapshot_sha`/`ts` fields (written by the turn fixture, simulating the hook) still exist unchanged, alongside the newly merged `prompt`/`model`/etc. fields.

---

## Shared Patterns

### Error convention (stderr + exit 1)
**Source:** every command file in `src/commands/`, canonical example `src/commands/status.js` lines 38-41
**Apply to:** all failure branches in `record-prompt.js` (missing session, missing stdin, malformed JSON, non-string prompt, non-object usage, no turns yet)
```javascript
console.error('git turn: <message>');
process.exit(1);
```

### Best-effort cache write (never throw to caller)
**Source:** `src/hooks/post-commit.js` lines 60-82 (`try { insertTurn(...) } catch {}`)
**Apply to:** `record-prompt.js`'s call to `updatePromptFields()` — the note write (source of truth) must succeed and return before the cache update is attempted, and the cache update must never crash the process if it fails.

### "Never bare HEAD" turn resolution
**Source:** `src/blame-util.js` lines 28-37 (`parseSnapshotMessage`), `src/session.js` lines 107-116 (`listTurns`)
**Apply to:** `record-prompt.js`'s target-turn resolution — never call `headSha()` from `src/git.js` directly.

### Redact-before-stringify
**Source:** `src/redact.js` module header comment, lines 18-19
**Apply to:** `record-prompt.js` — `redact(payload.prompt)` must run on the raw string before it is merged into any object that gets `JSON.stringify`'d for the note write.

### Module shape (`'use strict'`, plain `run(args)`, single export)
**Source:** every file in `src/commands/`, e.g. `src/commands/status.js` lines 1, 36, 53
**Apply to:** `src/commands/record-prompt.js`

## No Analog Found

None — every file in scope has at least a role-match analog in the existing codebase (see table above). The stdin-JSON-reading idiom itself has no in-repo analog (zero existing `process.stdin`/`readFileSync(0, ...)` usage), but RESEARCH.md Focus Q3 already supplies the standard zero-dependency Node idiom to use, and the surrounding command shape (error convention, module structure) is fully covered by existing analogs.

## Metadata

**Analog search scope:** `src/`, `src/commands/`, `src/hooks/`, `src/helpers/`, `bin/`
**Files scanned:** `src/git.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js`, `src/redact.js`, `src/redact.test.js`, `src/commands/status.js`, `src/commands/status.test.js`, `src/hooks/post-commit.js`, `src/helpers/turn-fixtures.js`, `bin/git-turn`
**Pattern extraction date:** 2026-09-18

# Phase 6: Verification, Redact Command & Purge Procedure - Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 12 (7 source, 5 test)
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/commands/show.js` (modify) | controller/CLI command | request-response (git-notes read) | `src/commands/record-prompt.js` (sha-resolution pattern) | role-match, exact for the fix itself |
| `src/commands/log.js` (modify, `--no-cache` fallback) | controller/CLI command | request-response (git-notes read) | `src/commands/show.js`'s own object-walk section (same file family) | exact |
| `src/commands/cost.js` (modify) | controller/CLI command | request-response (git-notes read + compute) | `src/commands/show.js` (post-fix) | exact |
| `src/commands/redact.js` (new) | controller/CLI command | CRUD (read-modify-write on a note) | `src/commands/record-prompt.js` | exact |
| `src/git.js` — `purgeNotesHistory()` (new function) | service/utility (git plumbing) | batch (destructive ref rewrite) | `snapshotWorktree()` in same file | role-match |
| `src/commands/gc.js` (modify — `--purge-notes` flag) | controller/CLI command | event-driven (flag dispatch) | `gc.js`'s own existing `--rebuild` branch | exact |
| `bin/git-turn` (modify — register `redact`) | router/config | request-response (dispatch table) | `bin/git-turn`'s own `COMMANDS` array + help text | exact |
| `src/commands/show.test.js` (new) | test | integration | `src/commands/record-prompt.test.js` | exact |
| `src/commands/log.test.js` (new) | test | integration | `src/commands/record-prompt.test.js` | exact |
| `src/commands/cost.test.js` (new) | test | integration (async) | `src/commands/record-prompt.test.js` + `cost.js`'s own `loadPricing()` cache mechanics | role-match |
| `src/commands/redact.test.js` (new) | test | integration | `src/commands/record-prompt.test.js` | exact |
| `src/git.test.js` (extend) | test | integration (object-store assertions) | `src/git.test.js`'s own `updateNote` describe block | exact |

## Pattern Assignments

### `src/commands/show.js` (controller, request-response) — MODIFY

**Analog:** `src/commands/record-prompt.js` lines 88-94 (the correct sha-resolution pattern), and `show.js` itself already imports what it needs.

**Current bug** (`show.js` lines 1-28, read this session):
```javascript
const { git, gitSafe, shouldColor } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
...
  // Get metadata from note
  const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', turn.sha]);   // BUG: turn.sha is the snapshot sha, not the real head
  let meta = {};
  try { meta = note ? JSON.parse(note) : {}; } catch {}

  // Real HEAD sha lives in the snapshot commit's own message body, not
  // notes — refs/notes/git-turn has never carried a `head` field.
  const { headSha } = parseSnapshotMessage(turn.sha);
  const head = headSha || turn.sha;
```
`parseSnapshotMessage` is already imported and already called two lines below the broken lookup — it is just never used to resolve the notes-lookup sha. `headSha`/`head` is currently only used for the header line, not for the notes lookup itself.

**Required fix pattern** (move the `parseSnapshotMessage` call above the notes lookup and use its result):
```javascript
const { headSha } = parseSnapshotMessage(turn.sha);
const head = headSha || turn.sha;

const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head]);
let meta = {};
try { meta = note ? JSON.parse(note) : {}; } catch {}
```
This exact reorder-and-resolve pattern is verified live in 06-RESEARCH.md Focus Question 1's "Confirmed fix" snippet.

**`--with-prompts` gate to add** (copy `log.js`'s existing gate, lines 14 and 33-35 of `log.js`):
```javascript
// log.js line 14:
const withPrompts = args.includes('--with-prompts');
// log.js lines 33-35:
if (withPrompts && row.prompt) {
  console.log(`         prompt: ${row.prompt.slice(0, 80)}...`);
}
```
Apply the same `args.includes('--with-prompts')` check in `show.js`'s `run(args)` and wrap the existing `if (meta.prompt) { ... }` block (currently unconditional, lines 34-36) with `if (withPrompts && meta.prompt)`.

**Error handling pattern:** No try/catch needed beyond the existing `gitSafe` (never throws) + `try { JSON.parse } catch {}` pattern already in the file — keep as-is.

---

### `src/commands/log.js` (controller, request-response) — MODIFY (`--no-cache` git-object-walk path only)

**Analog:** `log.js`'s own cache-backed branch already works correctly; the fix is internal reordering in the same file.

**Current bug** (`log.js` lines 51-59, read this session):
```javascript
for (const { turn_n, sha } of turns) {
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', sha], { stdio: ['pipe', 'pipe', 'ignore'] }); // BUG: sha is snapshot sha
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    // Real HEAD sha lives in the snapshot commit's own message body, not
    // notes — refs/notes/git-turn has never carried a `head` field.
    const { headSha } = parseSnapshotMessage(sha);
    const head = headSha || sha;
```
Identical defect shape to `show.js` — `parseSnapshotMessage(sha)` is called two lines below the broken lookup.

**Required fix pattern:** move the `parseSnapshotMessage(sha)` call above the notes `gitSafe` call, exactly mirroring the `show.js` fix above:
```javascript
const { headSha } = parseSnapshotMessage(sha);
const head = headSha || sha;

const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
let meta = {};
try { meta = note ? JSON.parse(note) : {}; } catch {}
```
No change needed to the cache-backed branch (lines 20-42) — it is already correct (keyed by `(session_id, turn_n)`, not sha).

---

### `src/commands/cost.js` (controller, request-response) — MODIFY

**Analog:** `show.js` (post-fix) for the sha-resolution pattern; `cost.js`'s own existing `computeCost()`/`lookupPrice()` need no change.

**Current bug** (`cost.js` lines 114-120, read this session):
```javascript
for (const { turn_n, sha } of turns) {
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', sha], { stdio: ['pipe', 'pipe', 'ignore'] }); // BUG
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    const model = meta.model || null;
    const usage = meta.usage || null;
```
Unlike `show.js`/`log.js`, `cost.js` has **no `parseSnapshotMessage` import at all today** — must be added.

**Required fix pattern:**
```javascript
// add to imports (cost.js currently imports only gitDir, gitSafe from '../git'):
const { parseSnapshotMessage } = require('../blame-util');

// in the loop, before the notes lookup:
const { headSha } = parseSnapshotMessage(sha);
const head = headSha || sha;
const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
```

**No change needed:** `computeCost()` (lines 68-75) and `lookupPrice()` (lines 45-66) — already correct per RESEARCH.md Focus Question 2; verification-only for this part.

---

### `src/commands/redact.js` (new controller, CRUD read-modify-write)

**Analog:** `src/commands/record-prompt.js` (entire file, 121 lines) for structure/error style; `show.js` for turn-resolution convention; `src/redact.js`'s `'[REDACTED]'` literal for the placeholder text; `src/git.js`'s `updateNote()` for the write.

**Session/turn resolution pattern** (copy verbatim from `show.js` lines 7-18):
```javascript
function run(args) {
  const session = readSession();
  if (!session) { console.error('git turn: not initialized'); process.exit(1); }

  const turnN = parseInt(args[0], 10);
  if (isNaN(turnN)) { console.error('Usage: git turn show <N>'); process.exit(1); }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === turnN);
  if (!turn) { console.error(`git turn: turn ${turnN} not found`); process.exit(1); }
```
(Substitute `Usage: git turn redact <N>` for the usage message.)

**Note write pattern** (copy verbatim from `record-prompt.js` lines 90-103 — `updateNote` merge-not-overwrite):
```javascript
const { headSha } = parseSnapshotMessage(turn.sha);   // same resolution fix as show.js/cost.js/log.js
const noteSha = headSha || turn.sha;

updateNote(NOTES_REF, noteSha, existing => ({
  ...existing,
  prompt: '[REDACTED]',
}));
```

**Cache sync pattern** (copy verbatim from `record-prompt.js` lines 105-116):
```javascript
try {
  const { updatePromptFields } = require('../cache');
  updatePromptFields(session.session_id, turnN, { prompt: '[REDACTED]' });
} catch (e) {
  process.stderr.write(`git turn: warning: cache update failed (${e.message})\n`);
}
```

**No-op guard when nothing to redact** — no existing exact analog for this specific check, but follows the same "read existing state before writing" discipline as `updateNote()` itself:
```javascript
const existingRaw = getNote(NOTES_REF, noteSha);
let existing = {};
try { existing = existingRaw ? JSON.parse(existingRaw) : {}; } catch { existing = {}; }
if (!existing.prompt) {
  console.log(`Turn ${turnN}: no prompt recorded, nothing to redact`);
  return;
}
```

**No confirmation prompt** — matches D-02; grep of `src/commands/` confirms no `readline`/prompt library anywhere in `revert.js`/`redo.js`, so `redact.js` should not introduce one either.

**Placeholder string:** use the literal `'[REDACTED]'` from `src/redact.js` line 83 (`out.replace(re, () => { count++; return '[REDACTED]'; })`) — same string, for visual consistency between automatic scanning and manual redact.

**Module shape:** `'use strict'` header + single `module.exports = { run };`, matching every other file in `src/commands/`.

---

### `src/git.js` — `purgeNotesHistory()` (new function, batch/destructive)

**Analog:** `snapshotWorktree()` in the same file (lines 93-155) — closest existing analog for "build a new commit via `commit-tree` with controlled parent list, then move a ref to it."

**Existing conventions to reuse from `snapshotWorktree()`:**
- Parentless commit pattern (`snapshotWorktree()` conditionally omits `-p` when there's no HEAD yet, lines 141-144):
```javascript
const parentSha = headSha();
const commitArgs = parentSha !== '0'.repeat(40)
  ? ['commit-tree', worktreeTree, '-p', parentSha, '-m', message || 'git-turn snapshot']
  : ['commit-tree', worktreeTree, '-m', message || 'git-turn snapshot'];
```
`purgeNotesHistory()` always omits `-p` (that is the entire point — sever the ancestor chain) — no conditional needed, unlike `snapshotWorktree()`.

- Env override for author identity (`snapshotWorktree()` line 148):
```javascript
{ env: { GIT_AUTHOR_NAME: 'git-turn', GIT_AUTHOR_EMAIL: '', ...env } }
```
Reuse this shape for the purge's `commit-tree` call, per RESEARCH.md's Assumption A2.

- `updateRef(ref, sha)` (already exported from `git.js` lines 72-74) — use directly to move `refs/notes/git-turn` to the new parentless commit; no new ref-write helper needed.

- `git()` vs `gitSafe()` distinction (lines 20-36) — **critical per RESEARCH.md Pitfall 3**: the `reflog expire` step MUST use `gitSafe()` (swallows the "no reflog" exit-255 error), while `rev-parse`, `commit-tree`, `update-ref`, and `gc --prune=now` should use the throwing `git()` since those must succeed.

**Concrete function to add** (verified live per RESEARCH.md Focus Question 7 — use this body, exported alongside the other git.js functions):
```javascript
function purgeNotesHistory(ref) {
  const currentSha = gitSafe(['rev-parse', ref]);
  if (!currentSha) {
    return { purged: false, reason: `ref ${ref} does not exist` };
  }

  const tree = git(['rev-parse', `${ref}^{tree}`]);
  const newCommit = git(
    ['commit-tree', tree, '-m', 'git-turn: purge notes history'],
    { env: { GIT_AUTHOR_NAME: 'git-turn', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'git-turn', GIT_COMMITTER_EMAIL: '' } }
  );
  updateRef(ref, newCommit);

  // Missing reflog is expected and non-fatal — the update-ref above already
  // severed the ancestor chain, which is the load-bearing step.
  gitSafe(['reflog', 'expire', '--expire=now', ref]);

  git(['gc', '--prune=now']);

  return { purged: true, oldSha: currentSha, newSha: newCommit };
}
```
Add `purgeNotesHistory` to the final `module.exports` block (line 215-221).

---

### `src/commands/gc.js` (controller, event-driven flag dispatch) — MODIFY

**Analog:** `gc.js`'s own existing `--rebuild` branch, lines 31-41 (read this session):
```javascript
function run(args) {
  if (args.includes('--rebuild')) {
    try {
      const { rebuild } = require('../cache');
      rebuild({ verbose: true });
      console.log('Cache rebuilt.');
    } catch (e) {
      console.error('git turn gc: cache rebuild failed:', e.message);
      process.exit(1);
    }
    return;
  }
  ...
```
This is the exact dispatch shape to mirror: an early `if (args.includes('--flag'))` branch at the top of `run()`, lazy-`require` the helper module, do the real action, `console.log` a confirmation, `return` (not fall through to the rest of `run()`).

**`--purge-notes` branch to add** (place before the `--rebuild` check or after — order doesn't matter since both `return`):
```javascript
if (args.includes('--purge-notes')) {
  const { purgeNotesHistory } = require('../git');
  const { NOTES_REF } = require('../session');
  console.error('git turn gc: this permanently deletes ALL unreachable objects in this');
  console.error('repository (git gc --prune=now is not scoped to notes) — including any');
  console.error('dangling commits from other tools with no ref protecting them.');
  const result = purgeNotesHistory(NOTES_REF);
  if (!result.purged) {
    console.log(`Nothing to purge: ${result.reason}`);
    return;
  }
  console.log(`Purged notes history for ${NOTES_REF} (old tip ${result.oldSha.slice(0, 7)} -> new tip ${result.newSha.slice(0, 7)}).`);
  console.log('Old note blobs are now unreachable and have been pruned.');
  return;
}
```
Warning goes to stderr **before** running (no confirmation prompt, per D-02/`--rebuild`'s style — errors on failure use `console.error` + `process.exit(1)`, matching `--rebuild`'s own catch block; `purgeNotesHistory` here doesn't throw, so no try/catch needed).

---

### `bin/git-turn` — MODIFY (register `redact`)

**Analog:** the file's own existing `COMMANDS` array and help text (lines 8 and 13-32, read this session).

**Change 1 — `COMMANDS` array** (line 8):
```javascript
const COMMANDS = ['init', 'log', 'show', 'diff', 'blame', 'bisect', 'heatmap', 'revert', 'redo', 'branch', 'status', 'gc', 'session', 'cost', 'export', 'record-prompt', 'redact'];
```

**Change 2 — help text** (insert a line in the existing block, lines 13-32, alongside `redo`):
```
  redact <N>              Scrub a turn's captured prompt after the fact
```
No other change needed — `bin/git-turn`'s dispatch mechanism (lines 41-51) already generically resolves `src/commands/<cmd>.js` and calls `.run(args)`; `redact.js`'s synchronous `run()` needs no special-casing (same as `show.js`/`log.js`, not the async `cost.js`/promise-catching branch at lines 49-51).

---

### `src/commands/show.test.js` (new test file)

**Analog:** `src/commands/record-prompt.test.js` (entire file) for `describe`/`beforeEach`/`afterEach` scaffolding, `makeTestRepo()` + `startSession()` fixture setup, and the `seedHookNote()` helper pattern.

**Scaffolding to copy verbatim** (record-prompt.test.js lines 1-25):
```javascript
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

describe('show command', () => {
  let dir, origCwd, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    const { startSession } = require('../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });
```

**Note-seeding helper to copy verbatim** (record-prompt.test.js lines 91-103, `seedHookNote()`), then drive a real `record-prompt.js` call via the `runWithStdin`-style helper (lines 32-76) targeting `record-prompt`, followed by a real `show.js` `run(['1'])` call with `console.log` captured the same way (`out.push(args.join(' '))`).

**Assertions to write** (per 06-RESEARCH.md Focus Question 4 — these only pass once `show.js`'s sha-resolution fix ships):
```javascript
assert.match(out.join('\n'), /why did this break/);
assert.match(out.join('\n'), /claude-sonnet-4-5/);
```

---

### `src/commands/log.test.js` (new test file)

**Analog:** same as `show.test.js` — `record-prompt.test.js` scaffolding — plus must exercise BOTH `log.js` code paths (cache-backed default and `--no-cache`) as two separate tests, since they have independent correctness states per RESEARCH.md.

```javascript
test('log --with-prompts (cache path) renders real captured prompt end-to-end', () => { /* default path, already correct — regression guard */ });
test('log --with-prompts --no-cache renders real captured prompt end-to-end', () => { /* exercises the fixed object-walk path */ });
```

---

### `src/commands/cost.test.js` (new test file)

**Analog:** `record-prompt.test.js` scaffolding + `src/helpers/test-repo.js`'s `HOME` override (line 22: `env: { ...process.env, HOME: dir }`) for a network-free pricing fixture, since `cost.js`'s `pricingCachePath()` (line 14) resolves via `os.homedir()` which reads `process.env.HOME`.

**Pricing fixture helper to add** (per RESEARCH.md Focus Question 5, no existing analog — new helper local to this test file):
```javascript
const { join } = require('path');
const { writeFileSync } = require('fs');

function seedFakePricing(dir, modelKey, priceEntry) {
  writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({
    _fetched_at: Date.now(),
    data: { [modelKey]: priceEntry },
  }));
}
```

**Async test note:** `cost.js`'s `run()` is `async` (the project's one async command) — the test callback must `await` or return the promise; `node:test` supports this natively, no extra harness beyond what `record-prompt.test.js` already established for sync commands.

**Assertion example** (`1000 * 0.000003 + 500 * 0.000015 = 0.0105`):
```javascript
assert.match(out.join('\n'), /\$0\.0105/);
```

---

### `src/commands/redact.test.js` (new test file)

**Analog:** `record-prompt.test.js` scaffolding, in particular the `readNote()` helper (lines 78-86) for post-write assertions, and its "second call merges instead of replacing" test shape (lines 117-126) as the model for redact's "leaves other fields intact" test.

**Key assertions to write** (per REDACT-02 and D-01):
```javascript
test('redact <N> clears prompt but leaves model/usage/latency_ms/tool_summary intact', () => { ... });
test('redact <N> no-ops when there is no prompt to redact', () => { ... });
test('redact <N> exits 1 for a non-existent turn number', () => { ... }); // mirrors show.js's `turn ${turnN} not found` path
```

---

### `src/git.test.js` (extend — `purgeNotesHistory()` tests)

**Analog:** the file's own existing `describe('updateNote', ...)` block (lines 9-24 for scaffolding, `makeTestRepo()` + `process.chdir` + `rmSync` cleanup — identical pattern, no new fixture style needed).

**Critical test — object-store-level assertion, not note-content-level** (per RESEARCH.md's explicit warning that a content-only test would miss a regression to the naive/broken purge sequence):
```javascript
describe('purgeNotesHistory', () => {
  // ... same beforeEach/afterEach as updateNote's describe block ...

  test('actually removes the old note blob from the object store', () => {
    const sha = headSha();
    addNote('git-turn', sha, JSON.stringify({ prompt: 'SECRET-MARKER' }));
    const oldNoteCommit = gitSafe(['rev-parse', 'refs/notes/git-turn']);
    updateNote('git-turn', sha, () => ({ prompt: '[REDACTED]' }));

    const { purgeNotesHistory } = require('./git');
    const result = purgeNotesHistory('refs/notes/git-turn');
    assert.equal(result.purged, true);

    assert.throws(() => execFileSync('git', ['cat-file', '-e', oldNoteCommit], { cwd: dir }));
  });

  test('tolerates a ref with no reflog (does not crash)', () => { /* Pitfall 3 edge case */ });

  test('returns { purged: false } for a ref that does not exist', () => { /* rev-parse fails */ });
});
```

## Shared Patterns

### sha-resolution-before-notes-lookup (the phase's core cross-cutting fix)
**Source:** `src/blame-util.js` lines 28-37 (`parseSnapshotMessage`), already correctly consumed by `src/commands/record-prompt.js` lines 90-94.
**Apply to:** `show.js`, `log.js` (`--no-cache` path), `cost.js`, and the new `redact.js` — every one of these must resolve `parseSnapshotMessage(turn.sha).headSha || turn.sha` BEFORE calling `gitSafe(['notes', ..., 'show', <sha>])` or `updateNote(...)`. This is the single most important shared pattern in this phase — RESEARCH.md's Pitfall 1 explicitly warns against shipping tests without this fix.
```javascript
const { headSha } = parseSnapshotMessage(turn.sha);  // or `sha` in log.js's loop variable naming
const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', headSha || turn.sha]);
```

### updateNote() merge-not-overwrite
**Source:** `src/git.js` lines 187-213.
**Apply to:** `redact.js` (new) — reuse unchanged, no new git plumbing. Same pattern `record-prompt.js` already uses.

### gitSafe vs git() for tolerable-vs-fatal git calls
**Source:** `src/git.js` lines 20-36.
**Apply to:** `purgeNotesHistory()` — `reflog expire` MUST use `gitSafe()` (tolerates missing reflog, exit 255); `rev-parse`/`commit-tree`/`update-ref`/`gc --prune=now` MUST use `git()` (throw on failure, since these are load-bearing).

### Flag-dispatch-and-return at top of run()
**Source:** `src/commands/gc.js` lines 31-41 (`--rebuild`).
**Apply to:** `gc.js`'s new `--purge-notes` branch — same shape: `if (args.includes('--flag')) { ...; return; }` before falling into the rest of `run()`.

### `'[REDACTED]'` literal placeholder
**Source:** `src/redact.js` line 83.
**Apply to:** `redact.js` (new command) — use the identical string for visual/UX consistency between automatic secret-scanning and manual post-hoc redaction (per D-01 and RESEARCH.md's "Don't Hand-Roll" table).

### Test scaffolding: makeTestRepo + startSession + seedHookNote + runWithStdin-style capture
**Source:** `src/commands/record-prompt.test.js` (entire file) and `src/helpers/test-repo.js`/`src/helpers/turn-fixtures.js`.
**Apply to:** all 5 new/extended test files — `show.test.js`, `log.test.js`, `cost.test.js`, `redact.test.js` reuse this scaffolding directly; `git.test.js` reuses only the `makeTestRepo()`/`process.chdir`/`rmSync` half (no session/turn fixtures needed for the low-level `purgeNotesHistory` tests).

## No Analog Found

None — every file in this phase has a strong existing analog, per RESEARCH.md's own "Key insight": every piece of new code needed already has a reusable primitive somewhere in the codebase.

## Metadata

**Analog search scope:** `src/commands/`, `src/git.js`, `src/session.js`, `src/blame-util.js`, `src/redact.js`, `bin/git-turn`, `src/helpers/`, existing test files (`record-prompt.test.js`, `git.test.js`)
**Files scanned:** show.js, log.js, cost.js, gc.js, record-prompt.js, redact.js (scanner), git.js, blame-util.js, session.js, bin/git-turn, test-repo.js, turn-fixtures.js, record-prompt.test.js, git.test.js
**Pattern extraction date:** 2026-09-21

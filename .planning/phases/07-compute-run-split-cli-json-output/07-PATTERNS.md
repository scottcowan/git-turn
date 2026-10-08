# Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output - Pattern Map

**Mapped:** 2026-10-08
**Files analyzed:** 11 (5 modified command files + their 5 test siblings + 1 new module; new module's test file counted separately below)
**Analogs found:** 11 / 11 (every file has an in-repo analog — this phase is a refactor of existing files plus one wholly new module with no direct analog, documented below)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/commands/log.js` | command/controller | request-response (read + format) | `src/commands/show.js` (same note-read + sha-resolution shape) | exact (sibling command, same phase) |
| `src/commands/show.js` | command/controller | request-response (read + format + diff passthrough) | `src/commands/diff.js` (shares diff/color logic verbatim) | exact |
| `src/commands/diff.js` | command/controller | request-response (diff passthrough) | `src/commands/show.js` (shares `shouldColor()`/`gitSafe(['diff',...])` pattern) | exact |
| `src/commands/blame.js` | command/controller | request-response (two-path read + format) | `src/commands/log.js` (cache-vs-fallback dual path) | role-match (blame's dual-path is unique but structurally parallel to log's cache/no-cache branch) |
| `src/commands/cost.js` | command/controller | request-response, async (network fetch + CRUD-like aggregation) | `src/commands/log.js` (turn iteration + note read) | role-match (only async command; log.js is the closest sync analog for the turn-iteration body) |
| `src/diff-render.js` (NEW) | utility/transform | transform (string in -> string/object out, pure) | `src/blame-util.js` (pure parsing helpers: `parseHunkHeader`, `parseSnapshotMessage`, `parseBlamePorcelain`) | role-match (no prior "renderer" module exists; `blame-util.js` is the closest pure-function-module precedent and the direct source of `parseHunkHeader` to reuse) |
| `src/commands/log.test.js` | test | request-response | `src/commands/diff.test.js` (richest existing example of the shared test harness) | exact |
| `src/commands/show.test.js` | test | request-response | `src/commands/diff.test.js` | exact |
| `src/commands/diff.test.js` | test | request-response | itself — already establishes the pattern other test files must extend | exact |
| `src/commands/blame.test.js` | test | request-response | `src/commands/diff.test.js` (harness) + `src/commands/log.test.js` (dual-path assertions) | role-match |
| `src/commands/cost.test.js` | test | request-response, async | `src/commands/diff.test.js` (harness), adapted for `async run()`/`await compute()` | role-match |
| `src/diff-render.test.js` (NEW) | test | transform (pure unit test, no repo fixture needed) | `src/blame-util.test.js` (pure-function unit tests, no `makeTestRepo()` needed) | role-match |

## Pattern Assignments

### `src/commands/log.js` (controller, request-response)

**Analog:** itself (refactor target) + `src/commands/show.js` for the note-read/sha-resolution idiom to preserve verbatim.

**Imports pattern** (`src/commands/log.js` lines 1-5):
```javascript
'use strict';

const { gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
```
Keep this import block as-is in the refactor — no new imports needed for REFACTOR-01 itself.

**Current structure to extract into `compute()`** (lines 7-71): everything between the `readSession()` guard and the final loop currently calls `console.log`/`console.error`/`process.exit` directly and `return`s early inside the cache branch (line 37) and the no-turns branch (line 48). Per RESEARCH.md Pattern 1, convert to:
```javascript
function compute(args) {
  const session = readSession();
  if (!session) throw new Error('git turn: not initialized. Run `git turn init` first.');
  // ... build `lines` array instead of console.log, `return lines.join('\n')`
  // --json branch returns JSON.stringify(rows...) before building `lines`
}

function run(args) {
  try {
    console.log(compute(args));
  } catch (e) {
    if (args.includes('--json')) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
```

**Sha-resolution pattern to preserve verbatim** (lines 52-55, also present in `show.js` lines 24-25 and `cost.js` lines 117-118):
```javascript
const { headSha } = parseSnapshotMessage(sha);
const head = headSha || sha;
```
Do not re-derive this in the new `--json` branch — call it exactly once per turn, same as today.

**`module.exports`** (line 73): `module.exports = { run };` becomes `module.exports = { run, compute };` — same convention as every other command file will adopt.

---

### `src/commands/show.js` (controller, request-response + diff passthrough)

**Analog:** `src/commands/diff.js` (identical `shouldColor()`/`gitSafe(['diff', colorArg, ...])` idiom) and itself for the sha-resolution block.

**Imports pattern** (lines 1-5):
```javascript
'use strict';

const { git, gitSafe, shouldColor } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
```
Add `const { parseDiff, renderRich } = require('../diff-render');` when wiring DIFF-01.

**Diff-passthrough pattern shared with `diff.js`** (lines 42-51):
```javascript
const colorArg = shouldColor() ? '--color=always' : '--color=never';
if (prev) {
  const diffOut = gitSafe(['diff', colorArg, prev.sha, turn.sha]) || '(no changes)';
  console.log(diffOut);
} else {
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const diffOut = gitSafe(['diff', colorArg, emptyTree, turn.sha]) || '(no changes)';
  console.log(diffOut);
}
```
Per RESEARCH.md Pattern 2, the `--plain` path keeps this exact `gitSafe(['diff', colorArg, ...])` call; the rich (default) path instead calls `gitSafe(['diff', '--color=never', shaA, shaB])` and feeds the raw text to `renderRich()`. Note the duplicated `emptyTree` constant here vs. `diff.js`'s module-level `EMPTY_TREE` (line 6 of diff.js) — natural to consolidate into `src/diff-render.js` or a shared constant during this refactor, per RESEARCH.md's "Reusable Assets" callout.

**Guard/error pattern to convert** (lines 8-18): five `console.error` + `process.exit(1)` call sites become `throw new Error(...)` — same message text, to preserve byte-identical `--plain`/unflagged stderr output per D-05.

---

### `src/commands/diff.js` (controller, request-response, diff passthrough)

**Analog:** itself — this file is the cleanest existing specimen of the pattern to replicate into `show.js`.

**Full current structure** (lines 1-59) — note the `findTurn` nested closure (lines 32-39) that calls `process.exit(1)` *inside* a nested function, which is the one call site RESEARCH.md's canonical_refs flags explicitly (`process.exit(1)` at lines 12/18/26/36 inside nested `findTurn`). This nested closure must also throw, not `console.error`+`process.exit`:
```javascript
function findTurn(n) {
  const t = turns.find(t => t.turn_n === n);
  if (!t) throw new Error('git turn: turn ' + n + ' not found');
  return t;
}
```

**Core diff-fetch pattern** (lines 54-56):
```javascript
const colorArg = shouldColor() ? '--color=always' : '--color=never';
const out = gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)';
console.log(out);
```
This becomes the `--plain` branch inside `compute()`. The default (rich) branch instead does:
```javascript
const rawText = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
const { renderRich } = require('../diff-render');
return renderRich(rawText, { color: shouldColor() });
```
and the `--json` branch does:
```javascript
const { parseDiff } = require('../diff-render');
const { added, removed } = parseDiff(rawText);
return JSON.stringify({ sha_a: shaA, sha_b: shaB, diff: rawText, added, removed });
```

**`EMPTY_TREE` constant** (line 6): `const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';` — already module-level here; `show.js` currently re-declares the same literal inline (its line 48). Natural dedup point.

---

### `src/commands/blame.js` (controller, two-path request-response)

**Analog:** `src/commands/log.js` for the cache/no-cache dual-branch shape; blame's own `formatLine()` helper (lines 11-13) is already the right pattern — keep it as the single formatter both paths push through.

**Shared formatter already correct** (lines 9-13):
```javascript
function formatLine(attr, lineNo, content) {
  return `${attr.padEnd(24)} ${String(lineNo).padStart(4)}) ${content}`;
}
```
No change needed to this helper itself — RESEARCH.md Pitfall 2 only requires that **both** branches push into one `lines` array and `return lines.join('\n')` once, rather than each branch independently calling `console.log` in a loop and `return`-ing (current lines 46-58 for the tracked branch, 69-75 for the untracked-fallback branch).

**Stderr side-channel to eliminate** (line 36 — RESEARCH.md Pitfall 1, the single most important fix in this file):
```javascript
process.stderr.write(`git turn: warning: ${collisions.length} duplicate head_sha value(s) in turn history; attribution may be ambiguous\n`);
```
Convert to a leading line in the returned string (text mode) or a `warnings: [...]` array entry (`--json` mode) — do not leave this as a direct stderr write inside `compute()`.

**Two-path output building to unify** (lines 45-58 tracked branch, 61-76 untracked-fallback branch): both already call the shared `formatLine()`; the only change needed is `console.log(...)` → `lines.push(...)` in both branches, converging on one `return lines.join('\n')` at the end of `compute()`. `--json` must produce the same shape regardless of which branch ran: `{ file, tracked: true|false, warnings: [...], lines: [{line, attribution, content}] }`.

**Error sites to convert** (lines 18-19, 25-26, 41-42, 65-66): same `console.error` + `process.exit(1)` → `throw new Error(...)` conversion as the other four files.

---

### `src/commands/cost.js` (controller, async, request-response)

**Analog:** `src/commands/log.js` for the turn-iteration + note-read body; `lookupPrice()`/`computeCost()` (lines 48-77) are already pure and need **zero changes** — they are the model for what a correctly-pure helper looks like in this codebase.

**Already-pure helpers to leave untouched** (lines 48-77):
```javascript
function lookupPrice(pricing, model) { /* ... exact match then prefix-stripping candidates ... */ }
function computeCost(price, usage) { /* ... weighted sum over usage fields ... */ }
```
These are the direct precedent for "a pure function in this codebase" — no `console.*`, no `process.*`, deterministic input→output. Any new helper extracted from the command bodies (e.g. a `gatherTurnRows()` in log.js, or a `buildCostRows()` in cost.js) should match this shape exactly.

**Stderr progress-indicator relocation** (lines 91/93, per RESEARCH.md Pitfall 3 — move out of `compute()` into `run()`):
```javascript
// today, inside what becomes compute()'s body:
process.stderr.write('Fetching pricing data...\r');
pricing = await loadPricing();
process.stderr.write('                        \r');
```
Target shape for `run()` (RESEARCH.md Code Examples, "Pitfall 3"):
```javascript
async function run(args) {
  process.stderr.write('Fetching pricing data...\r');
  try {
    const out = await compute(args);
    process.stderr.write('                        \r');
    console.log(out);
  } catch (e) {
    process.stderr.write('                        \r');
    if (args.includes('--json')) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
    console.error(e.message);
    process.exit(1);
  }
}
```

**Turn-iteration + sha-resolution body to extract into `compute()`** (lines 116-143) — reuses the identical `parseSnapshotMessage(sha).headSha || sha` idiom from `log.js`/`show.js` (line 117-118); keep calling it exactly once per turn, same as today.

**Async `run()`/`compute()` shape** (RESEARCH.md Code Examples, "Async command"):
```javascript
async function run(args) {
  try {
    console.log(await compute(args));
  } catch (e) { /* same as sync shape */ }
}
module.exports = { run, compute };
```

---

### `src/diff-render.js` (NEW module — utility/transform, pure)

**No direct analog exists in the codebase** — this is a genuinely new capability (RESEARCH.md's own conclusion: "DIFF-01 is a wholly new capability"). The closest structural precedent is `src/blame-util.js`, which is the model for "a module of small pure parsing functions, each independently unit-testable, exported together."

**Reuse, don't fork** (`src/blame-util.js` lines 142-151):
```javascript
function parseHunkHeader(line) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1], 10),
    oldCount: m[2] !== undefined ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3], 10),
    newCount: m[4] !== undefined ? parseInt(m[4], 10) : 1,
  };
}
```
`src/diff-render.js` must `require('./blame-util').parseHunkHeader` rather than re-implementing this regex — per RESEARCH.md's "Don't Hand-Roll" table and this project's own established "one primitive, N consumers" convention.

**Color-detection reuse** (`src/git.js` lines 14-18):
```javascript
function shouldColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}
```
`diff-render.js` must call `require('./git').shouldColor()` from the command files (diff.js/show.js pass the already-computed `{ color }` option into `renderRich()`) — never re-derive NO_COLOR/FORCE_COLOR/TTY logic inside `diff-render.js` itself.

**Module shape to follow** (`src/blame-util.js` lines 216-227, the exports convention):
```javascript
module.exports = {
  listAllTurns,
  listAllTurnsFromRefs,
  parseSnapshotMessage,
  buildHeadShaIndex,
  isAncestor,
  reachableFrom,
  orderByCommitTopology,
  parseHunkHeader,
  parseBlamePorcelain,
  annotateFromSnapshots,
};
```
`src/diff-render.js` should export `{ parseDiff, renderRich }` in the same flat, named-exports style — no default export, no class.

**Full draft implementation** — RESEARCH.md already contains a complete, concrete draft (parseDiff + renderRich, ANSI constants, padRow/termWidth helpers) at 07-RESEARCH.md lines 234-318. Treat that draft as the starting point for this file; it already follows the `blame-util.js` reuse pattern (imports `parseHunkHeader` at its own line 2) and the flat-exports convention. Confidence on the algorithm itself is explicitly MEDIUM per RESEARCH.md — plan a manual terminal eyeball before considering DIFF-01 done.

---

### Test files: `log.test.js`, `show.test.js`, `blame.test.js`, `cost.test.js` (modified) and `diff-render.test.js` (new)

**Analog for all command test files:** `src/commands/diff.test.js` (full file, 151 lines) — this is the canonical harness shape already used project-wide.

**Harness setup pattern** (`diff.test.js` lines 1-31):
```javascript
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');
const { makeTestRepo } = require('../helpers/test-repo');
const { snapshotWorktree, updateRef } = require('../git');
const { ensureDirs, newSession, readSession, incrementTurn, turnRef } = require('../session');
const { run } = require('./diff');

describe('diff command', () => {
  let dir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    ensureDirs();
    newSession();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });
```
Change `const { run } = require('./diff');` to `const { run, compute } = require('./diff');` when adding direct `compute()` test cases.

**`console.log` capture-and-join idiom** (lines 73-86, repeated throughout the file) — this is the mechanical justification RESEARCH.md cites for why REFACTOR-01's existing-tests-pass-unmodified bar holds:
```javascript
const logs = [];
const origLog = console.log;
console.log = (...args) => logs.push(args.join(' '));
try {
  run(['1']);
} finally {
  console.log = origLog;
}
const output = logs.join('\n');
assert.ok(typeof output === 'string');
```
New `compute()`-direct test cases should skip the console-capture entirely and just assert on the return value:
```javascript
test('compute returns a string directly', () => {
  makeTurn('a');
  const output = compute(['1']);
  assert.ok(typeof output === 'string');
});
```

**`process.exit` stub idiom for error-path tests** (lines 53-69) — existing pattern to preserve for `run()`'s own error-shape tests; new `compute()` error tests should instead use `assert.throws`:
```javascript
// existing run()-level pattern (keep for run() tests):
const origExit = process.exit;
let exitCode = null;
process.exit = (code) => { exitCode = code; throw new Error('process.exit(' + code + ')'); };
try { run(['1']); } catch (e) { if (!e.message.startsWith('process.exit')) throw e; }
finally { process.exit = origExit; }
assert.equal(exitCode, 1);

// new compute()-level pattern:
test('compute throws when not initialized', () => {
  rmSync(join(dir, '.git', 'git-turn', 'session.json'), { force: true });
  assert.throws(() => compute(['1']), /not initialized/);
});
```

**`FORCE_COLOR`/`NO_COLOR` env-var save/restore idiom** (lines 106-150) — reuse verbatim for any new rich-render color test in `diff.test.js`/`show.test.js`/`diff-render.test.js`:
```javascript
const origForceColor = process.env.FORCE_COLOR;
process.env.FORCE_COLOR = '1';
// ... run/assert ...
if (origForceColor === undefined) delete process.env.FORCE_COLOR;
else process.env.FORCE_COLOR = origForceColor;
```

**`src/diff-render.test.js` (new) — no repo fixture needed.** Unlike the command test files, `parseDiff()`/`renderRich()` are pure string-in/string-out functions and do not need `makeTestRepo()`/`beforeEach`/`afterEach` at all — construct raw unified-diff fixture strings directly:
```javascript
'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiff, renderRich } = require('./diff-render');

describe('diff-render', () => {
  const SAMPLE = [
    'diff --git a/foo.txt b/foo.txt',
    'index 0000000..1111111 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,2 +1,3 @@',
    ' context line',
    '-removed line',
    '+added line',
  ].join('\n');

  test('parseDiff counts added/removed lines', () => {
    const { added, removed } = parseDiff(SAMPLE);
    assert.equal(added, 1);
    assert.equal(removed, 1);
  });

  test('renderRich without color omits ANSI codes', () => {
    const out = renderRich(SAMPLE, { color: false });
    assert.doesNotMatch(out, /\x1b\[/);
  });

  test('renderRich with color emits ANSI background codes', () => {
    const out = renderRich(SAMPLE, { color: true });
    assert.match(out, /\x1b\[/);
  });
});
```

## Shared Patterns

### `compute()`/`run()` split — applies to all five command files
**Source:** RESEARCH.md Pattern 1 (07-RESEARCH.md lines 170-220), concretely modeled on the existing structure of all five files (`log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`).
**Apply to:** `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`.
```javascript
function run(args) {
  try {
    console.log(compute(args));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
    }
    console.error(e.message);
    process.exit(1);
  }
}
module.exports = { run, compute };
```
(cost.js variant is `async function run(args) { ... await compute(args) ... }` — see cost.js section above.)

### Sha resolution — applies to log.js, show.js, cost.js (not diff.js/blame.js, which don't need it)
**Source:** `src/blame-util.js` `parseSnapshotMessage()` (lines 28-37), already called identically at `log.js:54`, `show.js:24-25`, `cost.js:117-118`.
```javascript
const { headSha } = parseSnapshotMessage(sha);
const head = headSha || sha;
```
**Rule:** every new `--json` branch must call this exact helper, never re-derive sha resolution from `listTurns()`'s raw `sha` field (RESEARCH.md Pitfall 5 / Don't Hand-Roll table — this bug has shipped twice before).

### Color detection — applies to diff.js, show.js, and the new diff-render.js
**Source:** `src/git.js` `shouldColor()` (lines 14-18).
```javascript
function shouldColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}
```
**Rule:** `diff-render.js` never re-implements this; command files compute `shouldColor()` once and pass `{ color }` into `renderRich()`.

### Hunk-header parsing — applies only to the new diff-render.js
**Source:** `src/blame-util.js` `parseHunkHeader()` (lines 142-151) — reuse via `require('./blame-util').parseHunkHeader`, do not fork a second regex.

### Error conversion — applies to all five command files
**Pattern:** every `console.error(msg); process.exit(1);` pair (log.js lines 10-12; show.js lines 9, 12, 18; diff.js lines 11-13, 17-19, 25-27, 35-36 inside `findTurn`; blame.js lines 18-19, 25-26, 41-42, 65-66; cost.js lines 82-84, 95-97) becomes `throw new Error(msg)` inside `compute()`, with the exact same message string preserved so the non-`--json` stderr path in `run()`'s catch block is byte-identical to today's output.

### `module.exports` convention — applies to all five command files
**Source:** every command file today ends with `module.exports = { run };` (e.g. `log.js:73`, `diff.js:59`). Becomes `module.exports = { run, compute };` uniformly — the new `src/diff-render.js` instead exports `{ parseDiff, renderRich }` (no `run`, it is not a CLI-dispatched command).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/diff-render.js` | utility/transform | transform | No prior "rendering" module exists in this codebase — DIFF-01 is a wholly new capability per RESEARCH.md. Closest structural precedent (pure-function module convention) is `src/blame-util.js`, used above; the actual algorithm has no in-repo analog and is drafted fresh in RESEARCH.md Pattern 3 (07-RESEARCH.md lines 234-318). Planner should treat that draft as the implementation starting point rather than searching further for an analog that doesn't exist. |

## Metadata

**Analog search scope:** `src/commands/*.js`, `src/commands/*.test.js`, `src/blame-util.js`, `src/git.js`, `src/cache.js`, `src/session.js` (all read directly or inspected this session; no other directories needed — this is a closed, five-file-plus-one-new-module phase per RESEARCH.md's own scope statement).
**Files scanned:** 11 source command files, 2 shared utility modules (`blame-util.js`, `git.js`), 1 full test file (`diff.test.js`) read in full as the canonical test-harness exemplar; `log.js`/`show.js`/`diff.js`/`blame.js`/`cost.js` read in full.
**Pattern extraction date:** 2026-10-08

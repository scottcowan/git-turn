# Phase 4: Secret Redaction Scanner - Pattern Map

**Mapped:** 2026-09-17
**Files analyzed:** 2 (both new)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/redact.js` | utility (pure string transform, no I/O) | transform | `src/blame-util.js` | role-match (module style/shape; blame-util does git-backed parsing, redact.js is pure — no git dependency — but the file-level conventions are identical) |
| `src/redact.test.js` | test | request-response (function-in, object-out, no fixtures/repo needed) | `src/blame-util.test.js` | role-match (test harness conventions identical; blame-util.test.js needs a git fixture repo via `helpers/test-repo`, `redact.test.js` needs no such setup since it has no I/O) |

No stronger analog exists in the codebase — `src/cache.js` and `src/git.js` were also reviewed but are further from redact.js's shape (cache.js does SQLite I/O, git.js shells out to git); `blame-util.js` is the best fit purely for **module-authoring conventions** (`'use strict'`, top comment block, plain functions, single `module.exports` at bottom), not for its git/I/O logic, which `redact.js` has none of.

## Pattern Assignments

### `src/redact.js` (utility, transform)

**Analog:** `src/blame-util.js` (for module conventions only — do not copy git-specific logic)

**File header / top-of-module comment pattern** (`src/blame-util.js` lines 1-8):
```javascript
'use strict';

// Cross-session turn enumeration, head_sha reverse index, topology ordering,
// ancestry check, and (Task 3) unified-diff hunk + blame-porcelain parsers
// plus the untracked-file forward annotator. All git access goes through
// git/gitSafe from ./git — never child_process directly.

const { gitSafe } = require('./git');
```
Apply this same shape to `src/redact.js`: `'use strict';` on line 1, a blank line, then a comment block describing scope/behavior/limitations (RESEARCH.md's Code Examples section already drafts this exact comment for redact.js — reuse it verbatim, it follows this convention).

**Plain-function, no-class pattern** (`src/blame-util.js` lines 12-18, `sortTurns`):
```javascript
function sortTurns(turns) {
  return turns.slice().sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.session_id !== b.session_id) return a.session_id < b.session_id ? -1 : 1;
    return a.turn_n - b.turn_n;
  });
}
```
`redact.js` should define `shannonEntropy`, `isWhitelisted`, and `redact` the same way — top-level `function name(...) { ... }` declarations, no classes, no arrow-function assignment to `const` for the primary exports (arrow consts are fine for small helpers per RESEARCH.md's draft, but the public function should be a named `function` declaration matching this style).

**Constants-before-functions pattern** (`src/blame-util.js` line 10):
```javascript
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
```
`redact.js` should declare its constant tables the same way, near the top, before any function definitions: `SECRET_PATTERNS`, `BASE64_CHARS`, `HEX_CHARS`, `BASE64_ENTROPY_LIMIT`, `HEX_ENTROPY_LIMIT`, `CANDIDATE_RUN_RE`, `GIT_SHA_RE`, `UUID_V4_RE` — all module-level `const`, never rebuilt per-call.

**Single `module.exports` object at bottom** (`src/blame-util.js` lines 216-227):
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
`blame-util.js` exports many internal helpers for direct unit testing. **`redact.js` must deviate from this breadth** per D-01's "no leaked structure" intent (confirmed in RESEARCH.md's Code Examples note): export **only** `redact`:
```javascript
module.exports = { redact };
```
Keep `SECRET_PATTERNS`, `shannonEntropy`, `isWhitelisted`, `CANDIDATE_RUN_RE`, etc. module-private (no `require('./redact')` access to internals — tests exercise `redact()` end-to-end only).

**No error-handling/try-catch pattern needed:** `blame-util.js`'s functions call `gitSafe` (which itself handles git subprocess failure) and don't wrap in try/catch at this layer. `redact.js` has even less need — it does pure string/regex/math operations with no I/O, no subprocess, no exceptions expected in normal operation. Do not add defensive try/catch around `String.prototype.replace`/`matchAll`/`Math.log2` — none of `blame-util.js`'s pure-transform functions (e.g. `sortTurns`, `parseHunkHeader`) do this either, consistent with the project's convention of only guarding at I/O boundaries.

**Guard-clause pattern for empty/null input** (implicit convention, confirmed via RESEARCH.md's own draft matching blame-util.js's defensive style at function entry — e.g. `blame-util.js`'s `annotateFromSnapshots` and `parseBlamePorcelain` short-circuit on empty input before doing work): `redact.js`'s `redact(text)` should open with `if (!text) return { text, count: 0 };` exactly as drafted in RESEARCH.md's Code Examples, matching this codebase's habit of an early return for falsy/empty input rather than throwing.

---

### `src/redact.test.js` (test, request-response)

**Analog:** `src/blame-util.test.js`

**Imports pattern** (`src/blame-util.test.js` lines 1-18):
```javascript
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('./helpers/test-repo');
const { startSession, makeTurn, makeUntrackedTurn } = require('./helpers/turn-fixtures');
const {
  listAllTurns,
  listAllTurnsFromRefs,
  buildHeadShaIndex,
  isAncestor,
  reachableFrom,
  orderByCommitTopology,
  parseHunkHeader,
  parseBlamePorcelain,
  annotateFromSnapshots,
} = require('./blame-util');
```
`redact.test.js` follows the same `'use strict'` + `node:test` + `node:assert/strict` import shape, but **imports only `redact`** (no fixture-repo helpers needed, since `redact()` has no git/filesystem dependency):
```javascript
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('./redact');
```

**No beforeEach/afterEach repo fixture needed:** `blame-util.test.js` lines 25-37 set up/tear down a full git test repo per test (`makeTestRepo()`, `process.chdir`, `closeDb()`, `rmSync`) because blame-util.js depends on git state. `redact.js` has zero I/O dependency, so `redact.test.js` should **omit** this setup entirely — a flat `describe`/`test` structure with no lifecycle hooks, consistent with "only add setup/teardown when the module under test actually needs it."

**`describe`/`test` nesting and assertion style** (`src/blame-util.test.js` lines 20, 39-55):
```javascript
describe('blame-util cross-session enumeration', () => {
  // ...
  test('listAllTurns returns turns across two distinct sessions (D-02)', () => {
    const session1 = startSession();
    makeTurn(session1, 'v1', git);
    makeTurn(session1, 'v2', git);

    const session2 = startSession();
    makeTurn(session2, 'v3', git);
    makeTurn(session2, 'v4', git);

    const turns = listAllTurns();
    assert.equal(turns.length, 4);
    const sessionIds = new Set(turns.map(t => t.session_id));
    assert.equal(sessionIds.size, 2);
  });
```
Test names reference decision IDs inline (e.g. `(D-02)`) when a test is validating a specific locked decision — `redact.test.js` should do the same, tagging fixtures with `(D-01)`, `(D-02)`, `(D-03)` where they directly validate those context decisions (RESEARCH.md's fixture draft already does this for D-02/D-03; carry it through consistently, including tagging the marker-format assertions with `(D-01)`).

**Assertion idioms** — `assert.equal`, `assert.deepEqual`, `assert.ok` used directly from `node:assert/strict` (no custom assertion helpers anywhere in the test suite) — `redact.test.js` should use the same three primitives exclusively, matching RESEARCH.md's fixture draft (`assert.equal(count, 1)`, `assert.ok(!text.includes(token))`, `assert.ok(text.includes(sha))`).

---

## Shared Patterns

### Module authoring convention
**Source:** `src/blame-util.js` lines 1-10, `src/cache.js` lines 1-13
**Apply to:** `src/redact.js`
```javascript
'use strict';

// <scope/behavior comment block>

const { ... } = require('./...');   // only if the module has real deps — redact.js has none
```
Every module in `src/` (`blame-util.js`, `cache.js`, `git.js`, `session.js`) opens with `'use strict';`, then a comment block explaining scope before any code. `redact.js` follows this exactly, using the top-comment already drafted in `04-RESEARCH.md`'s Code Examples section (documents the two-pass design, the known false negatives, and the "call before JSON.stringify" calling convention).

### Zero-dependency discipline
**Source:** `package.json` (no `dependencies` block), confirmed by `src/cache.js` line 3-5 comment ("Requires Node 22+ (node:sqlite built-in)")
**Apply to:** `src/redact.js`
Only Node built-ins may be `require`d or referenced (`RegExp` literals, `String.prototype.matchAll`/`.replace`, `Math.log2`). No `require('crypto')` needed either — RESEARCH.md's verification used `crypto.randomBytes` only to *generate* test fixtures during research, not as a runtime dependency of `redact.js` itself. Do not add any import to `redact.js` beyond what's needed for `module.exports`.

### Test runner convention
**Source:** `package.json` `scripts.test: "node --test"`, `src/blame-util.test.js` lines 1-4
**Apply to:** `src/redact.test.js`
`node --test` auto-discovers `*.test.js` under `src/` — no config file, no test framework dependency. `redact.test.js` requires no registration anywhere; placing it at `src/redact.test.js` (sibling to `src/redact.js`) is sufficient, exactly mirroring `blame-util.js`/`blame-util.test.js`'s sibling placement.

### Minimal public surface / no leaked internals (D-01-driven, redact-specific — not shared with blame-util.js)
**Source:** RESEARCH.md Code Examples section, "Note on internal exports"
**Apply to:** `src/redact.js` only
Unlike `blame-util.js` (exports 10 helpers for direct unit testing), `redact.js` exports **only** `{ redact }`. This is a deliberate deviation from the blame-util.js analog, driven by D-01's "zero leaked structure" decision — flag this explicitly to the planner so it isn't "corrected" back toward blame-util.js's broader-export style during implementation.

## No Analog Found

None — both files have adequate analogs in `src/blame-util.js` / `src/blame-util.test.js` for structural/style conventions. The actual regex/entropy domain logic has no in-repo precedent (confirmed in CONTEXT.md's "Reusable Assets: None directly reusable") and must be sourced from `04-RESEARCH.md`'s Code Examples section (fully-verified `SECRET_PATTERNS`, `shannonEntropy`, `isWhitelisted`, `redact` implementation, and the complete `redact.test.js` fixture list), not from any existing codebase file.

## Metadata

**Analog search scope:** `src/` (top-level modules and their sibling `.test.js` files); `src/commands/`, `src/hooks/`, `src/helpers/` reviewed via directory listing but not deeply searched — none are closer analogs than `blame-util.js` since none share redact.js's "pure transform, no I/O" shape.
**Files scanned:** `src/blame-util.js`, `src/blame-util.test.js`, `src/cache.js`, `src/git.js` (directory listing + partial reads), `package.json` (referenced via RESEARCH.md's prior verification)
**Pattern extraction date:** 2026-09-17

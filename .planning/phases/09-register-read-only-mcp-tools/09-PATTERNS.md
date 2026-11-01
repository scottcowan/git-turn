# Phase 9: Register Read-Only MCP Tools - Pattern Map

**Mapped:** 2026-11-01
**Files analyzed:** 14 (5 new tool adapters, 5 new test files, 2 modified command files, 1 modified server file, 2 existing test files gaining new cases)
**Analogs found:** 14 / 14 (RESEARCH.md itself contains a verified, worked example for every new file — this phase is unusually low-risk on the "no analog" axis)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp/tools/log.js` | controller (MCP tool adapter) | request-response | `.planning/research/ARCHITECTURE.md` Pattern 2 worked example (`log.js`) + `src/commands/log.js` | exact (research already wrote this one verbatim) |
| `src/mcp/tools/show.js` | controller (MCP tool adapter) | request-response | RESEARCH.md's `diff.js` adapter example (structurally closest — single required `turn` + rich/plain concerns) + `src/commands/show.js` | exact |
| `src/mcp/tools/diff.js` | controller (MCP tool adapter) | request-response | RESEARCH.md's worked `diff.js` adapter example (verbatim) + `src/commands/diff.js` | exact |
| `src/mcp/tools/blame.js` | controller (MCP tool adapter) | request-response | RESEARCH.md's worked `blame.js` adapter example (verbatim) + `src/commands/blame.js` | exact |
| `src/mcp/tools/cost.js` | controller (MCP tool adapter, async) | request-response | RESEARCH.md's worked `cost.js` adapter example (verbatim) + `src/commands/cost.js` | exact |
| `src/mcp/tools/log.test.js` | test | request-response | `src/commands/show.test.js` (seedHookNote/makeTurn/startSession fixture pattern) | role-match |
| `src/mcp/tools/show.test.js` | test | request-response | `src/commands/show.test.js` (same file — fixture helpers reused, assertions target `handler()` not `run()`) | exact |
| `src/mcp/tools/diff.test.js` | test | request-response | `src/commands/diff.test.js` (color/plain assertion style) + `src/commands/show.test.js` (fixture helpers) | role-match |
| `src/mcp/tools/blame.test.js` | test | request-response | `src/commands/show.test.js` (fixture helpers); no direct blame-adapter analog needed beyond RESEARCH.md's worked example | role-match |
| `src/mcp/tools/cost.test.js` | test | request-response, async | `src/commands/show.test.js` (fixture helpers) + RESEARCH.md's async-handler note (Pitfall A) | role-match |
| `src/mcp/server.js` (MODIFIED) | provider/registration | request-response | RESEARCH.md's "`src/mcp/server.js` after Phase 9" worked example (verbatim target state) | exact |
| `src/commands/show.js` (MODIFIED — Gap 1 + Gap 2) | service/command | CRUD-ish text rendering | itself (surgical addition, no external analog needed) + `src/commands/diff.js` for the Gap 2 color-override shape | exact |
| `src/commands/diff.js` (MODIFIED — Gap 2) | service/command | request-response | `src/commands/show.js`'s identical `shouldColor()` call-site shape (sibling file, same fix applied twice) | exact |
| `src/commands/show.test.js` (MODIFIED — new cases) | test | request-response | itself, existing `VERIFY-01`-style tests in same file | exact |
| `src/commands/diff.test.js` (MODIFIED — new cases) | test | request-response | itself, existing `--plain`/`FORCE_COLOR`/`NO_COLOR` tests already in file (lines ~109-189) | exact |

## Pattern Assignments

### `src/mcp/tools/log.js` (controller, request-response)

**Analog:** `.planning/research/ARCHITECTURE.md` lines 130-158 (Pattern 2, the exact file this phase must produce) + `src/commands/log.js`

This is a verified-correct, ready-to-use template — not just inspiration. Copy it, then add the second export the planner needs for direct-handler testing (RESEARCH.md's `{ register, handler }` convention, confirmed in its "Pattern: tool adapter" section):

```js
// src/mcp/tools/log.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/log');

async function handler({ withPrompts, noCache }) {
  const argv = [withPrompts && '--with-prompts', noCache && '--no-cache'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: compute(argv) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_log',
    {
      description: 'List turns in the current session (mirrors `git turn log`). Supports withPrompts/noCache.',
      inputSchema: z.object({
        withPrompts: z.boolean().optional().describe('Include first line of captured prompt per turn'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**Note:** `log.js`'s `compute()` (`src/commands/log.js` lines 77-148) has no color concerns and no positional args — the simplest of the five adapters.

---

### `src/mcp/tools/show.js` (controller, request-response)

**Analog:** RESEARCH.md's `diff.js` worked example (lines 180-210, structurally identical shape) + `src/commands/show.js` (lines 8-88, for the exact `turn` semantics and D-02 color override)

```js
// src/mcp/tools/show.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/show');

async function handler({ turn, withPrompts }) {
  const argv = [String(turn), withPrompts && '--with-prompts'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: compute(argv, { color: false }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_show',
    {
      description: 'Full diff and metadata for turn N (mirrors `git turn show <N>`). Params: turn, withPrompts.',
      inputSchema: z.object({
        turn: z.number().int().describe('Turn number to show'),
        withPrompts: z.boolean().optional().describe('Include the captured prompt text if present'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**Error-message contract to preserve (MCP-09):** `src/commands/show.js` line 18 throws `Usage: git turn show <N>` and line 26 throws `` `git turn: turn ${turnN} not found` `` — the adapter's `catch (e)` must surface `e.message` verbatim, never reformatted (per RESEARCH.md's "Error-message contract" section).

---

### `src/mcp/tools/diff.js` (controller, request-response)

**Analog:** RESEARCH.md's fully worked example, verbatim (lines 180-210) — copy as-is:

```js
// src/mcp/tools/diff.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/diff');

async function handler({ turn, toTurn }) {
  const argv = [String(turn), toTurn !== undefined ? String(toTurn) : null].filter(v => v !== null);
  try {
    return { content: [{ type: 'text', text: compute(argv, { color: false }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_diff',
    {
      description: 'Diff turn N-1 vs N, or turn N vs M if toTurn given (mirrors `git turn diff <N> [M]`). Params: turn, toTurn (optional).',
      inputSchema: z.object({
        turn: z.number().int().describe('Turn number to diff'),
        toTurn: z.number().int().optional().describe('Optional second turn number — diffs turn against toTurn directly instead of turn-1 vs turn'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**Reference semantics in `src/commands/diff.js` (lines 7-71):** positional `N` required (`Usage: git turn diff <N> [M]` on `NaN`), optional `M`; `findTurn()` throws `` `git turn: turn ${n} not found` ``.

---

### `src/mcp/tools/blame.js` (controller, request-response)

**Analog:** RESEARCH.md's fully worked example, verbatim (lines 248-280):

```js
// src/mcp/tools/blame.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/blame');

async function handler({ file, noCache }) {
  const argv = [file, noCache && '--no-cache'].filter(Boolean);
  try {
    // blame.js's opts.stderr is a terminal-only duplicate-sha warning sink —
    // no MCP content channel exists for it, so pass a no-op.
    return { content: [{ type: 'text', text: compute(argv, { stderr: () => {} }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_blame',
    {
      description: 'Per-line turn attribution for a file (mirrors `git turn blame <file>`). Params: file, noCache.',
      inputSchema: z.object({
        file: z.string().describe('Path to the file to blame'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**Why `file: z.string()` matters (Pitfall C):** `src/commands/blame.js` line 28 does `args.find(a => !a.startsWith('--'))` — a non-string reaching this would throw a raw `TypeError` instead of a clean `Usage:` `Error`. Zod's schema typing prevents this before the handler ever runs; don't add a defensive `typeof` check in the handler itself — fix would belong in the schema, not the handler, if ever needed.

---

### `src/mcp/tools/cost.js` (controller, request-response, async)

**Analog:** RESEARCH.md's fully worked example, verbatim (lines 212-243):

```js
// src/mcp/tools/cost.js
'use strict';
const { z } = require('zod');
const { compute } = require('../../commands/cost');

async function handler({ all, noCache }) {
  const argv = [all && '--all', noCache && '--no-cache'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: await compute(argv) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_cost',
    {
      description: 'Token usage and cost for the current session (mirrors `git turn cost`). Params: all, noCache.',
      inputSchema: z.object({
        all: z.boolean().optional().describe('Report across all sessions, not just current'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };
```

**Pitfall A (must not skip):** `src/commands/cost.js` line 156 declares `async function compute(...)` — this is the ONLY one of the five `compute()` functions that is async. Forgetting `await` here produces `"[object Promise]"` in the tool result text, not a thrown error, so it's easy to miss in testing if the test itself also forgets to await.

---

### `src/mcp/server.js` (MODIFIED — provider/registration)

**Analog:** RESEARCH.md's "`src/mcp/server.js` after Phase 9" section (lines 284-305) — this is the literal target state, and the current file (read directly, 15 lines) already has the comment marking the insertion point (`// Zero tools registered this phase (Phase 8 scope). Phase 9 adds server.registerTool(...) calls here.`):

Current `src/mcp/server.js` (full file):
```js
'use strict';
const { McpServer } = require('@modelcontextprotocol/server');

function createServer() {
  return new McpServer({
    name: 'git-turn',
    version: require('../../package.json').version,
  });
}

module.exports = { createServer };
```

Target shape (add imports + 5 `register()` calls before `return server`, note the `server` variable must be captured in a local before returning — RESEARCH.md's version is a very minor rewrite of the current single-expression return):
```js
'use strict';
const { McpServer } = require('@modelcontextprotocol/server');
const log = require('./tools/log');
const show = require('./tools/show');
const diff = require('./tools/diff');
const blame = require('./tools/blame');
const cost = require('./tools/cost');

function createServer() {
  const server = new McpServer({ name: 'git-turn', version: require('../../package.json').version });
  log.register(server);
  show.register(server);
  diff.register(server);
  blame.register(server);
  cost.register(server);
  return server;
}

module.exports = { createServer };
```

---

### `src/commands/show.js` (MODIFIED — Gap 1 tool_summary + Gap 2 color override)

**Analog:** itself — surgical, additive changes only; no external pattern needed since the current structure is read in full above.

**Gap 1 — plain-text branch currently (lines 68-77) never prints `tool_summary`**, though the `--json` branch already does (line 58: `tool_summary: meta.tool_summary ?? null`). Add one line following the existing `Model:`/`Latency:` one-field-per-line convention:
```js
  if (meta.model) lines.push(`Model: ${meta.model}`);
  if (meta.latency_ms) lines.push(`Latency: ${meta.latency_ms}ms`);
  if (meta.tool_summary) {
    lines.push('Tool summary: ' + Object.entries(meta.tool_summary).map(([k, v]) => `${k}:${v}`).join(', '));
  }
```

**Gap 2 — color override.** Current (lines 80, 84) call `shouldColor()` directly at both the `--plain` branch and the rich-render branch:
```js
  if (plain) {
    const colorArg = shouldColor() ? '--color=always' : '--color=never';
    lines.push(gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)');
  } else {
    const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
    lines.push(renderRich(raw, { color: shouldColor(), width: process.stdout.columns || 120 }));
  }
```
Replace both call sites with a single local resolved once, defaulting to current behavior when `opts.color` is omitted (byte-identical CLI behavior preserved — `run()` never passes `color`):
```js
  const colorOn = opts.color !== undefined ? opts.color : shouldColor();
  if (plain) {
    const colorArg = colorOn ? '--color=always' : '--color=never';
    lines.push(gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)');
  } else {
    const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
    lines.push(renderRich(raw, { color: colorOn, width: process.stdout.columns || 120 }));
  }
```
**Must fix both branches in one pass** (RESEARCH.md Pitfall B) — a test calling `compute(['1', '--plain'], { color: false })` must also assert no ANSI escapes, not just the default rich-render path.

---

### `src/commands/diff.js` (MODIFIED — Gap 2 color override only, no Gap 1 equivalent)

**Analog:** `src/commands/show.js`'s identical fix (same shape, same two call sites) — this file has no `tool_summary`/plain-text gap, only the color one.

Current (lines 64-70):
```js
  if (plain) {
    const colorArg = shouldColor() ? '--color=always' : '--color=never';
    return gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)';
  }

  const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
  return renderRich(raw, { color: shouldColor(), width: process.stdout.columns || 120 });
```
Replace with the same `opts.color !== undefined ? opts.color : shouldColor()` local, used at both sites — identical pattern to `show.js` above, applied verbatim to this sibling file.

---

### `src/mcp/tools/*.test.js` (5 new test files — role: test, request-response)

**Analog:** `src/commands/show.test.js` (full fixture toolkit: `makeTestRepo`, `startSession`, `makeTurn`, `addNote`, `NOTES_REF` — read directly above, lines 1-96) + RESEARCH.md's "VERIFY-03 live round-trip pattern" (Code Examples section, lines 357-387) and "Success-path + thrown-error test shape" (lines 391-407), both already fully worked out.

**Setup/teardown pattern to copy verbatim** (from `show.test.js` lines 11-28):
```js
describe('show tool', () => {
  let dir, origCwd, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    const { startSession } = require('../../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });
  // ... note the relative-path depth change: one more ../ than src/commands/*.test.js
  // since these tests live in src/mcp/tools/, not src/commands/
});
```

**VERIFY-03 round-trip test (required for log/show/cost per RESEARCH.md's Pitfall-5 cross-reference), copy from RESEARCH.md Code Examples verbatim:**
```js
const { makeTestRepo } = require('../../helpers/test-repo');
const { makeTurn, startSession } = require('../../helpers/turn-fixtures');
const { addNote } = require('../../git');
const { NOTES_REF } = require('../../session');
const { handler } = require('./show');

test('VERIFY-03: git_turn_show reads a real hook-written note, not a hand-built fixture', async () => {
  const repo = makeTestRepo();
  process.chdir(repo.dir);
  const session = startSession();
  const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
  addNote(NOTES_REF, headSha, JSON.stringify({
    session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
    model: 'claude-sonnet-4-5', tool_summary: { Read: 2, Edit: 1 },
  }));

  const result = await handler({ turn: 1, withPrompts: false });
  assert.equal(result.isError, undefined);
  const text = result.content[0].text;
  assert.match(text, /claude-sonnet-4-5/);
  assert.match(text, /Read:2/);
});
```

**Success + error-path pair (required for all 5), copy from RESEARCH.md verbatim:**
```js
test('git_turn_diff success path matches CLI text', async () => {
  const result = await handler({ turn: 1 });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].text, require('../../commands/diff').compute(['1'], { color: false }));
});

test('git_turn_diff out-of-range turn returns isError, does not throw', async () => {
  const result = await handler({ turn: 999 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /turn 999 not found/);
});
```

**`cost.test.js` specific note:** handler is async, `compute()` is async — `await handler({...})` and compare against `await require('../../commands/cost').compute([...])`.

---

### `src/commands/show.test.js` (MODIFIED — new cases for Gap 1 + Gap 2)

**Analog:** itself — existing `VERIFY-01`-style tests in the same file follow the `seedHookNote()`/`makeTurn` pattern (lines 84-96 read above); add a sibling test that seeds a note with `tool_summary` and asserts the plain-text `compute()` output contains the rendered line, plus a `compute(['1', '--plain'], { color: false })` / rich-path ANSI-absence pair per Pitfall B.

### `src/commands/diff.test.js` (MODIFIED — new cases for Gap 2)

**Analog:** itself — existing color tests already at lines 109-189 (`FORCE_COLOR emits ANSI-colored diff output`, `NO_COLOR suppresses ANSI codes...`, `--plain byte-identical to inline gitSafe diff...`). New cases: `compute(['1', '2'], { color: false })` asserted free of ANSI regardless of `FORCE_COLOR` env being set in the test process, and the same for the `--plain` branch (`compute(['1', '2', '--plain'], { color: false })`).

## Shared Patterns

### MCP adapter shape (applies to all 5 `src/mcp/tools/*.js` files)
**Source:** `.planning/research/ARCHITECTURE.md` Pattern 2 (lines 122-158) and RESEARCH.md's four additional worked examples (diff/blame/cost, lines 179-280)
**Apply to:** `log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`
```js
try {
  return { content: [{ type: 'text', text: compute(argv) }] };
} catch (e) {
  return { content: [{ type: 'text', text: e.message }], isError: true };
}
```
Export both `register(server)` and the bare `handler` function (`module.exports = { register, handler }`) so tests call `handler` directly without a stdio transport.

### Error-message-verbatim contract (MCP-09)
**Source:** every `src/commands/*.js`'s `compute()` throws a plain `Error` whose `.message` is identical to what `run()`'s `catch` block prints via `console.error(e.message)` — confirmed directly in all five files read above.
**Apply to:** every tool adapter's `catch` block — never wrap, prefix, or reformat `e.message`.

### `shouldColor()` override threading (D-02 / Gap 2)
**Source:** `src/git.js` lines 14-18 (`shouldColor()`, zero params today)
**Apply to:** `src/commands/show.js` (2 call sites) and `src/commands/diff.js` (2 call sites)
```js
const colorOn = opts.color !== undefined ? opts.color : shouldColor();
```
`src/mcp/tools/show.js` and `src/mcp/tools/diff.js` call `compute(argv, { color: false })` unconditionally — this is the only permitted `compute()` signature change beyond what already exists (D-04), additive and default-preserving.

### Argv reconstruction (D-04)
**Source:** RESEARCH.md's "compute() calling convention" (D-04) — every adapter builds a CLI-flag-shaped array and filters falsy entries:
```js
const argv = [flagA && '--flag-a', flagB && '--flag-b'].filter(Boolean);
```
**Apply to:** all 5 adapters. Numeric positional args must be `String()`-coerced before being placed in `argv` (e.g. `diff.js`/`show.js`'s `turn`/`toTurn`), since `compute()`'s own `parseInt(positional[0], 10)` expects a string-ish array element the same way `process.argv` would supply.

### Test fixture toolkit (already exists, reused verbatim)
**Source:** `src/helpers/test-repo.js` (`makeTestRepo()`) and `src/helpers/turn-fixtures.js` (`startSession()`, `makeTurn(session, content, git, opts)`) — both read in full above, no changes needed.
**Apply to:** all 5 new `src/mcp/tools/*.test.js` files, plus the new cases added to `src/commands/show.test.js`/`diff.test.js`.

## No Analog Found

None. Every file in scope has either a verbatim worked example already written and verified in RESEARCH.md (the 5 adapters + server.js target state), or a direct sibling/self analog in the existing codebase (the 2 Gap modifications + all test files). This phase's research was unusually thorough — the planner should treat RESEARCH.md's Code Examples section as primary source, with this file's codebase excerpts (actual current file contents, not research's paraphrase) as the cross-check for exact line numbers and byte-for-byte current state.

## Metadata

**Analog search scope:** `src/commands/*.js`, `src/mcp/server.js`, `src/git.js`, `src/commands/*.test.js`, `src/helpers/*.js`, `.planning/research/ARCHITECTURE.md`
**Files scanned:** `src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`, `src/git.js`, `src/mcp/server.js`, `src/commands/show.test.js`, `src/commands/diff.test.js` (grep only), `src/helpers/test-repo.js`, `src/helpers/turn-fixtures.js`, `.planning/research/ARCHITECTURE.md` (Pattern 2, Build Order, Anti-Patterns sections)
**Pattern extraction date:** 2026-11-01

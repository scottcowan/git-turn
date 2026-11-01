---
phase: 09-register-read-only-mcp-tools
reviewed: 2026-11-01T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - AGENTS.md
  - src/commands/show.js
  - src/commands/show.test.js
  - src/commands/diff.js
  - src/commands/diff.test.js
  - src/mcp/server.js
  - src/commands/mcp.test.js
  - src/mcp/tools/log.js
  - src/mcp/tools/log.test.js
  - src/mcp/tools/blame.js
  - src/mcp/tools/blame.test.js
  - src/mcp/tools/cost.js
  - src/mcp/tools/cost.test.js
  - src/mcp/tools/show.js
  - src/mcp/tools/diff.js
  - src/mcp/tools/roundtrip.test.js
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-11-01
**Depth:** standard
**Files Reviewed:** 16 (plus `src/mcp/tools/show.test.js`/`diff.test.js` read in full as part of cross-checking)
**Status:** issues_found (no blockers; minor robustness/quality notes only)

## Summary

This phase registers all 5 read-only MCP tool adapters (`git_turn_log/show/diff/blame/cost`) into `createServer()`, threads an `opts.color` override through `show.js`/`diff.js` (Gap 2/D-02), adds a `tool_summary` line to `show.js`'s plain-text output (Gap 1), and closes VERIFY-03 with a genuine real-subprocess round-trip test.

I traced every one of the five adapters against its corresponding `src/commands/*.js` `compute()`:

- **Error path (point 1 of the review brief):** All 5 adapters wrap `compute()`/`await compute()` in `try/catch` and return `{ content: [{ type: 'text', text: e.message }], isError: true }` verbatim — confirmed by reading `log.js`, `blame.js`, `cost.js`, `show.js`, `diff.js` adapters line-by-line, and independently confirmed by the "isError survives and server stays alive" live-stdio test in `mcp.test.js` and the static purity check (no `process.exit`/`.run(` reachable). No gap found.
- **`cost.js` async handling (point 2):** `src/mcp/tools/cost.js:9` correctly does `text: await compute(argv)`. The `handler returns a Promise` test in `cost.test.js` and the live `[object Promise]` absence check in `roundtrip.test.js` both verify this empirically. No gap found — this is the one place Pitfall A warned about and it was implemented correctly.
- **`opts.color` override (point 3):** `show.js`/`diff.js` compute both use `const colorOn = opts.color !== undefined ? opts.color : shouldColor();` at exactly one `shouldColor()` call site each (both files reduced their two pre-existing `shouldColor()` calls to one, feeding `colorOn` into both the `--plain` and rich-render branches) — this satisfies Pitfall B (both branches covered, not just the default one). The MCP adapters (`src/mcp/tools/show.js:9`, `src/mcp/tools/diff.js:9`) unconditionally pass `{ color: false }`, never reading `FORCE_COLOR`/`NO_COLOR`/TTY state themselves. Confirmed against a live `FORCE_COLOR=1` stdio test in `mcp.test.js` and against the real-subprocess `roundtrip.test.js`. `opts.color === undefined` (the CLI's own `run()` call path) correctly falls back to `shouldColor()`, preserving byte-identical CLI behavior — verified via the 09-01-SUMMARY's reported regression-guard tests and confirmed by reading the diff itself. No gap found.
- **VERIFY-03 genuineness (point 5):** `src/mcp/tools/roundtrip.test.js` genuinely avoids `addNote`/`makeTurn`/fixture helpers — grepped and confirmed zero occurrences of those identifiers in the file. It drives real subprocesses: `execFileSync(... 'init')`, two real `git commit`s via `repo.git([...])` (which fire the real installed post-commit hook), and two real `execFileSync(... 'record-prompt')` calls with piped stdin. The `before()` block even asserts the Pitfall-5 precondition shape directly (`snapshot_sha` differs from `HEAD`'s own sha, matches the real turn-N ref) before any tool-handler assertions run, and fails loudly (via `assert`, not `test.skip`) if the hook didn't fire as expected. This is exactly what VERIFY-03 requires. No gap found.
- **Point 6 (unauthorized `--no-verify` commit):** Confirmed independently — `grep -r` for `husky|lefthook|core.hooksPath` across the diff shows no hook files or hook-installation logic were touched by this phase (the hits are all pre-existing `init.js`/`status.js`/`git.js`/AGENTS.md/README.md content unrelated to this phase's diff). Nothing in this phase's file list introduces a pre-commit hook or any other hook that `--no-verify` could plausibly have bypassed. No corroborating evidence of an actual bypass.

No security vulnerabilities, crashes, or incorrect-behavior defects were found in the reviewed files. The one warning below is a defense-in-depth/robustness note, and the info items are minor consistency/documentation nits.

## Warnings

### WR-01: MCP adapter handlers are not defensive against a caller bypassing the zod schema

**File:** `src/mcp/tools/show.js:6-7`, `src/mcp/tools/diff.js:6-7`

**Issue:** `registerTool`'s zod `inputSchema` guarantees `turn`/`toTurn` are validated numbers before the handler runs *when invoked through the real MCP protocol*. However, the exported `handler` function itself is also called directly by every test file in this phase (by design, per `09-RESEARCH.md`'s "independently testable without starting a real stdio transport" pattern) and is reachable by any future code that imports `src/mcp/tools/show.js`/`diff.js` directly. If such a caller passes `{ turn: undefined }` (e.g. a typo, a refactor that drops a required field, or a future caller that doesn't go through the zod-validated protocol path), `String(undefined)` produces the literal string `"undefined"`, which `parseInt("undefined", 10)` turns into `NaN`, which `compute()` correctly rejects with `Usage: git turn show <N>` — so this doesn't crash today, but it's an accidental safety net rather than an intentional one, and the resulting error message ("Usage: git turn show <N>") would be confusing in a context where the caller passed an object, not a CLI arg string. This is a robustness gap, not an active bug, since the only current caller (the MCP SDK's validated dispatch and this phase's own tests) always supplies a real number.

**Fix:** Low priority — document (e.g. a one-line comment) that `handler()` assumes zod-shaped input and is not a public safe-to-call-with-arbitrary-input API, or add an explicit guard: `if (typeof turn !== 'number') return { content: [{ type: 'text', text: 'turn is required' }], isError: true };` at the top of each handler that takes a required numeric/string param (`show`, `diff`, `blame`).

## Info

### IN-01: `tool_summary` rendering has no delimiter-collision guard

**File:** `src/commands/show.js:75`

**Issue:** `Object.entries(meta.tool_summary).map(([k, v]) => \`${k}:${v}\`).join(', ')` will render incorrectly if a future `tool_summary` key or value ever contains a literal `:` or `,` (e.g. a tool name like `Bash: rm -rf`). Today `tool_summary` keys are always plain tool names (`Read`, `Edit`, `Bash`, etc.) written by `record-prompt`'s own validated shape, so this isn't reachable in practice, but there's no validation in `show.js` itself that would catch a malformed note written by some other future producer.

**Fix:** Not urgent given current producers are trusted-and-controlled; if `tool_summary` ever becomes directly user-suppliable, add a `String(k).replace(/[:,]/g, '')`-style sanitize or switch to a JSON-safe rendering.

### IN-02: `blame.js`/`cost.js` MCP adapters suppress `opts.stderr` via two different idioms

**File:** `src/mcp/tools/blame.js:11` (no-op function `() => {}`) vs `src/mcp/tools/cost.js:9` (omits `opts` entirely)

**Issue:** Both achieve the same effect (no progress/warning text reaches the MCP content channel) but via different mechanisms, documented in 09-02-SUMMARY.md as an intentional per-command choice based on each command's internal guard style. This is a minor inconsistency a future reader might trip over when adding a 6th read-only tool and copying the "wrong" one of the two patterns as a template.

**Fix:** Purely cosmetic — consider standardizing on one idiom (e.g. always pass `{ stderr: () => {} }`) in a future cleanup pass; not worth a dedicated change now.

### IN-03: `AGENTS.md`'s MCP tool list omits the explicit note that `withPrompts`/`noCache`/`all` parameter *types* are booleans

**File:** `AGENTS.md:47-51`

**Issue:** The bulleted tool list (`git_turn_log (params: withPrompts, noCache)` etc.) names parameters but not their types or whether they're optional — an LLM client reading only `AGENTS.md` (as opposed to introspecting the live `tools/list` schema) would need to guess types. This is a minor completeness gap relative to D-01's "name every parameter" intent, since D-01 was about the in-protocol `description` field (which does read well per `log.js:19`'s wording), not `AGENTS.md`'s prose.

**Fix:** Optional — add parenthetical types if `AGENTS.md` is meant to be a standalone parameter reference, e.g. `git_turn_cost (params: all?: boolean, noCache?: boolean)`.

---

_Reviewed: 2026-11-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

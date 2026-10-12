---
phase: 07-compute-run-split-cli-json-output
reviewed: 2026-10-12T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/blame-util.js
  - src/commands/blame.js
  - src/commands/blame.test.js
  - src/commands/compute-purity.test.js
  - src/commands/cost.js
  - src/commands/cost.test.js
  - src/commands/diff.js
  - src/commands/diff.test.js
  - src/commands/log.js
  - src/commands/log.test.js
  - src/commands/show.js
  - src/commands/show.test.js
  - src/diff-render.js
  - src/diff-render.test.js
  - src/helpers/compute-purity-probe.js
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-10-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the compute()/run() split and `--json` work across `blame`, `cost`, `diff`, `log`, `show`, the shared `diff-render.js` renderer, `blame-util.js`, and the compute-purity probe/tests. The architectural pattern (pure `compute()` returning strings/JSON, thin `run()` wrapping console/process, injectable `opts.stderr` sink, no direct `child_process` outside `src/git.js`) is applied consistently and is well covered by tests, including a dedicated purity probe that stubs every output sink and asserts zero sink calls across all `compute()` paths. No injection vulnerabilities were found — all git invocations go through `execFileSync('git', [...])` with array args (`src/git.js`), never shell string interpolation.

The most significant finding is a real functional regression: `cost.js` parses the documented `--all` flag but never uses it, so `git turn cost --all` silently behaves identically to `git turn cost` instead of reporting across all sessions as AGENTS.md documents. The remaining findings are smaller robustness/consistency gaps: unvalidated numeric usage data that can silently poison cost totals with `NaN`, a `Math.max(...)` spread in the diff renderer that can crash on very large diffs, and a manually-built `sha:path` git object reference that breaks for filenames containing a colon.

## Critical Issues

### CR-01: `git turn cost --all` is parsed but has no effect — documented feature is a no-op

**File:** `src/commands/cost.js:86`
**Issue:** `compute()` parses the `--all` flag into `allSessions` on line 86 (`const allSessions = args.includes('--all');`) but that variable is never read again anywhere in the function. `turns` is always computed from `listTurns(session.session_id)` (line 99), i.e. only the current session, regardless of whether `--all` was passed. AGENTS.md explicitly documents this flag: "`--all` reports across all sessions, not just the current one." Right now, running `git turn cost --all` silently produces the exact same output as `git turn cost` with no error or warning — a documented feature is completely non-functional, and a caller relying on it (e.g. an agent computing total spend across all sessions) gets silently wrong (under-reported) data.
**Fix:**
```js
// Collect turns with notes
const turns = allSessions ? listAllSessionsTurns() : listTurns(session.session_id);
```
Implement (or wire up) a cross-session turn enumeration — `blame-util.js` already has `listAllTurns()` for exactly this cross-session use case (used by `blame`/`bisect`/`heatmap`) and could likely be adapted/reused here, including updating the output to group/report per-session when `--all` is set, and updating `cost.test.js` to cover the `--all` path (currently untested).

## Warnings

### WR-01: Unvalidated `usage` fields from notes can silently poison the whole session's cost totals with `NaN`

**File:** `src/commands/cost.js:70-77,138,147-151`
**Issue:** `computeCost()` does `(usage.input_tokens || 0) * price.input_per_mtok / 1_000_000` etc. with no check that `usage.input_tokens` (and the other three fields) are actually numbers. `usage` comes from a git note that `git turn record-prompt` writes from arbitrary stdin JSON (per AGENTS.md, fields are merged in from caller-supplied JSON with no type checking documented for `usage`'s inner fields beyond "expected in Anthropic's shape"). If any field is a non-numeric value (string, object, etc.) that isn't exactly `0`/falsy, the multiplication produces `NaN`. Critically, `cost !== null` (line 147) is still `true` for `NaN`, so `turnsWithCost` is incremented and `totalCost += cost` turns the *entire session's* total cost into `NaN` — one bad note silently corrupts the summary for every other (valid) turn in the session, both in text output (`$NaN`) and in the `--json` `total_cost`/`model_totals` fields, with no error or warning surfaced to the caller.
**Fix:**
```js
function computeCost(price, usage) {
  if (!price || !usage) return null;
  const nums = [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens];
  if (nums.some(v => v !== undefined && v !== null && typeof v !== 'number')) return null;
  const input = (usage.input_tokens || 0) * price.input_per_mtok / 1_000_000;
  const output = (usage.output_tokens || 0) * price.output_per_mtok / 1_000_000;
  const cacheRead = (usage.cache_read_input_tokens || 0) * price.cache_read_per_mtok / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * price.cache_write_per_mtok / 1_000_000;
  return input + output + cacheRead + cacheWrite;
}
```

### WR-02: Model-prefix stripping for display is case-sensitive while the pricing-lookup version is case-insensitive, producing inconsistent output

**File:** `src/commands/cost.js:52-53,140`
**Issue:** `lookupPrice()`'s candidate-generation regex strips a region prefix case-insensitively: `model.replace(/^(eu|us|ap|au)\.(?=anthropic\.)/i, '')` (line 53). The separate `modelDisplay` computation used for both text and `--json` output uses the same shape of regex but without the `/i` flag: `model.replace(/^(eu|us|ap|au)\.anthropic\./, '')` (line 140). For a model string with a differently-cased region/vendor prefix (e.g. `"US.anthropic.claude-sonnet-4-5"`), pricing lookup succeeds (price is found) but the displayed/returned model name still shows the raw unstripped prefix, inconsistent with the stripped name used internally for pricing — a real, if minor, display defect reachable with real input data.
**Fix:** Use the same case-insensitive regex (and ideally share one helper) for both the lookup-candidate stripping and the display stripping:
```js
const modelDisplay = model ? model.replace(/^(eu|us|ap|au)\.anthropic\./i, '') : '(no model recorded)';
```

### WR-03: `renderRich()`'s gutter-width calculation can throw `RangeError: Maximum call stack size exceeded` on large diffs

**File:** `src/diff-render.js:97-98`
**Issue:** `gutterWidth` is computed via `Math.max(1, ...allLineNos)` where `allLineNos` is built by flattening every line number across every hunk/file in the diff. Spreading a large array as individual arguments to `Math.max` is a well-known crash hazard in V8 (and other engines) once the array exceeds roughly tens of thousands of elements — the call simply throws instead of returning a sensible result. Since `diff`/`show --json`/`--plain` bypass this path but the default *rich* renderer (`renderRich`) always exercises it, a sufficiently large turn diff (e.g. a vendored dependency commit, a large generated file, or many files touched in one turn) would make `git turn diff`/`git turn show` crash with an unhandled exception instead of degrading gracefully to plain output.
**Fix:** Compute the max without spreading the whole array:
```js
const gutterWidth = String(allLineNos.reduce((m, n) => Math.max(m, n), 1)).length;
```

### WR-04: `annotateFromSnapshots()` builds a `sha:path` git revision string by hand, breaking for filenames containing a colon

**File:** `src/blame-util.js:205`
**Issue:** `gitSafe(['show', lastTurn.snapshot_sha + ':' + file], ...)` manually concatenates the snapshot sha and the file path with `:` to form a git `<rev>:<path>` object reference. If `file` itself legitimately contains a colon (a valid character in POSIX filenames, and increasingly common in filenames generated by tools, timestamps, Windows-style alternate-data-stream-like names copied into a repo, etc.), the resulting string is ambiguous/malformed for git's revision-path syntax, and `git show` will fail to resolve it. The caller then sees the generic "no history for `<file>`" error for an untracked file that does in fact have history — a correctness bug, not merely a cosmetic one, since the blame command's whole purpose is to resolve exactly this kind of file.
**Fix:** This is an inherent limitation of git's `rev:path` syntax rather than something `git-turn` invented, but it should at minimum be called out/handled: detect a colon in `file` up front and either escape appropriately (there is no universal escape for this ambiguity in git) or document the limitation clearly in `blame`'s help/README rather than surfacing a misleading "no history" error.

## Info

### IN-01: `blame.js`'s file-argument detection misclassifies filenames starting with `--`

**File:** `src/commands/blame.js:28`
**Issue:** `const file = args.find(a => !a.startsWith('--'));` assumes the target file never itself starts with `--`. A legitimately-named file (e.g. `--release-notes.txt`, which can exist and be tracked by git) would be mistaken for an unrecognized flag and skipped, causing `blame` to report "Usage: git turn blame <file> [--no-cache]" for a valid file argument.
**Fix:** Support a `--` separator convention (common CLI pattern) to disambiguate, e.g. `git turn blame -- --release-notes.txt`, and check for it before falling back to the `!startsWith('--')` heuristic.

### IN-02: `parseDiff()`'s `line === ''` branch is effectively dead code and risks fabricating a phantom content line if ever reached

**File:** `src/diff-render.js:72-75`
**Issue:** Inside a hunk, the `line === ''` branch synthesizes a context line with empty text. In practice this cannot be reached from real `git diff` output passed through this module: `src/git.js`'s `git()` wrapper always calls `.trim()`, and every genuine unified-diff content line inside a hunk carries a leading marker character (`+`, `-`, or a literal space for context — which produces at minimum a one-character line, never an empty string). If this module is ever reused by a caller that passes untrimmed or synthetic diff text (the module's own header comment notes it is designed to be reusable/MCP-safe going forward), this branch would silently insert a blank line into the rendered output that was never actually part of the diff, rather than being flagged/dropped like the `\ No newline...` case.
**Fix:** Either remove the branch (letting an unmatched line fall through unhandled, consistent with how `\ No newline` lines are intentionally dropped) or add a comment clarifying it is defensive-only and add a regression test exercising it directly via `parseDiff` with a crafted empty-line fixture.

### IN-03: `fetchPricing()` never checks the HTTP response status code

**File:** `src/commands/cost.js:18-29`
**Issue:** `fetchPricing()` buffers `res` data and attempts `JSON.parse` regardless of `res.statusCode`. A non-200 response (e.g. a transient 404/5xx or an HTML error page from GitHub) would produce a `SyntaxError` from `JSON.parse` that bubbles up as a cryptic `"could not load pricing data: Unexpected token ..."` message rather than a clear "pricing fetch failed with status 404" message.
**Fix:**
```js
res.on('end', () => {
  if (res.statusCode !== 200) {
    return reject(new Error(`pricing fetch failed with status ${res.statusCode}`));
  }
  try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
});
```

---

_Reviewed: 2026-10-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 06-verification-redact-command-purge-procedure
reviewed: 2026-09-21T13:22:16Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/commands/show.js
  - src/commands/show.test.js
  - src/commands/log.js
  - src/commands/log.test.js
  - src/commands/cost.js
  - src/commands/cost.test.js
  - src/commands/redact.js
  - src/commands/redact.test.js
  - src/git.js
  - src/git.test.js
  - src/commands/gc.js
  - src/commands/gc.test.js
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-21T13:22:16Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This phase fixes a real pre-existing bug (show/log/cost were resolving notes off the bare snapshot sha instead of the real HEAD sha) and adds `redact` and `gc --purge-notes` as the remediation path for a leaked secret. The core new logic — `purgeNotesHistory()`, `redact.js`, and the `--purge-notes` branch in `gc.js` — is well-commented, matches the documented design decisions (D-01/D-02/D-03), and is exercised by a solid set of tests (including the reflog-missing edge case and the concurrent-note-race case for `updateNote`).

However, review of the full `cost.js` file (in scope, not just the diff hunk) turned up a genuine correctness bug in `lookupPrice()`'s Bedrock/cross-region prefix normalization that silently defeats the very case it was written for, and no test exercises that branch. There are also several missing-error-handling gaps in the new redact/purge code paths: git-level failures (concurrent note writers, `git gc` contention) are allowed to propagate as raw uncaught exceptions instead of being surfaced as a clean CLI error, which is inconsistent with the try/catch pattern already used one line away for the cache update in the same functions.

## Critical Issues

### CR-01: `lookupPrice()`'s region-prefix candidate produces an unmatchable key, breaking Bedrock cost lookup

**File:** `src/commands/cost.js:51`
**Issue:** The second pricing-lookup candidate is built as:
```js
model.replace(/^(eu|us|ap|au)\./i, 'anthropic.'),
```
For a real Bedrock cross-region inference profile id such as `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, this *replaces* the `us.` prefix with `anthropic.` instead of stripping it, producing `anthropic.anthropic.claude-sonnet-4-5-20250929-v1:0` — a key that will never exist in the litellm pricing table (whose Bedrock entries are keyed as `anthropic.claude-...`, i.e. the `us.`/`eu.` prefix simply removed, not replaced). This is exactly backwards from the sibling display-normalization regex three lines below (`modelDisplay`, line 130), which correctly strips `eu|us|ap|au\.anthropic\.` down to nothing.

The net effect: for the one case this candidate exists to handle (region-prefixed Bedrock model ids), pricing lookup always fails, `lookupPrice()` returns `null`, and the row (and the running total) silently displays `?` / omits that turn's cost with no error to the user — the exact "cost tracking is broken but looks like it's just missing data" failure mode this feature is supposed to prevent.

No test exercises this candidate (`cost.test.js` only seeds a plain `claude-sonnet-4-5` key with no region prefix), so this regression would not be caught by the existing suite.

**Fix:**
```js
const candidates = [
  model,
  model.replace(/^(eu|us|ap|au)\.(?=anthropic\.)/i, ''),   // us.anthropic.X -> anthropic.X
  `anthropic.${model}`,
];
```
(Also drop the duplicate trailing `model` entry — see IN-01.)

## Warnings

### WR-01: `computeCost()` can silently poison the running total with `NaN`

**File:** `src/commands/cost.js:56-63`
**Issue:** `lookupPrice()` only validates `entry.input_cost_per_token` before building the price object:
```js
if (entry && entry.input_cost_per_token) {
  return {
    input_per_mtok: entry.input_cost_per_token * 1_000_000,
    output_per_mtok: entry.output_cost_per_token * 1_000_000,   // undefined * 1e6 = NaN if missing
    ...
```
If the matched pricing entry lacks `output_cost_per_token` (plausible for non-chat entries in the upstream litellm JSON, which this code fetches live from a URL it does not control), `output_per_mtok` becomes `NaN`. `computeCost()` then returns `NaN`, and `cost !== null` at cost.js:137 is `true` for `NaN` (only `null` is excluded), so `totalCost += cost` permanently turns the session's total into `NaN` for every subsequent turn — a silent, undetected corruption of the headline `Total cost` figure with no error message.
**Fix:** Validate both fields (and default missing ones to 0 rather than propagating `NaN`):
```js
if (entry && entry.input_cost_per_token != null && entry.output_cost_per_token != null) {
  return {
    input_per_mtok: entry.input_cost_per_token * 1_000_000,
    output_per_mtok: entry.output_cost_per_token * 1_000_000,
    cache_read_per_mtok: (entry.cache_read_input_token_cost || 0) * 1_000_000,
    cache_write_per_mtok: (entry.cache_creation_input_token_cost || 0) * 1_000_000,
  };
}
```

### WR-02: `redact.js` does not catch `updateNote()` failures, unlike the cache-update call two lines below

**File:** `src/commands/redact.js:52`
**Issue:** `updateNote()` (src/git.js:193-213) throws after exhausting its retries if the note changes concurrently between read and write (this is directly tested in `git.test.js:122-133`, proving it's a reachable failure mode, e.g. two `redact`/`record-prompt` invocations racing on the same note). In `redact.js`, this call is unguarded:
```js
updateNote(NOTES_REF, noteSha, existing => ({ ...existing, prompt: '[REDACTED]' }));

try {
  const { updatePromptFields } = require('../cache');
  updatePromptFields(session.session_id, turnN, { prompt: '[REDACTED]' });
} catch (e) {
  process.stderr.write(`git turn: warning: cache update failed (${e.message})\n`);
}
```
If `updateNote` throws, the process crashes with an unhandled exception and a raw Node stack trace instead of the clean `git turn: ...` + `process.exit(1)` pattern used everywhere else in this file (and everywhere else in this command family) for user-facing errors. This is inconsistent error-handling within the same function.
**Fix:**
```js
try {
  updateNote(NOTES_REF, noteSha, existing => ({ ...existing, prompt: '[REDACTED]' }));
} catch (e) {
  console.error(`git turn: redact failed: ${e.message}`);
  process.exit(1);
}
```

### WR-03: `purgeNotesHistory()` / `gc --purge-notes` has no error handling around `git gc --prune=now`

**File:** `src/git.js:256`, `src/commands/gc.js:38`
**Issue:** `git(['gc', '--prune=now'])` can fail for ordinary reasons — another git process holding `gc.pid`/the ref lock, insufficient disk space for the repack, a corrupt pack — and `git()` (src/git.js:20-28) throws on any nonzero exit. Neither `purgeNotesHistory()` nor its only caller (`gc.js`'s `--purge-notes` branch) catches this, so a transient lock contention (e.g. a concurrent `git gc` from a cron job or another terminal) surfaces as an uncaught exception and a raw stack trace to the user, even though by that point the notes ref has already been rewritten (`updateRef` at line 250 already ran) — leaving the user unsure whether the purge actually happened.
**Fix:** Wrap the `gc.js` call site (or `purgeNotesHistory` itself) and report clearly what succeeded:
```js
try {
  const result = purgeNotesHistory(NOTES_REF);
  ...
} catch (e) {
  console.error(`git turn gc: notes ref rewritten but pruning failed: ${e.message}`);
  console.error('The old note blob may still be reachable — rerun with no other git process active.');
  process.exit(1);
}
```

### WR-04: `fetchPricing()` has no request timeout

**File:** `src/commands/cost.js:18-28`
**Issue:** `https.get(PRICING_URL, ...)` has no `timeout` option and no `req.destroy()` on a stalled connection. If GitHub's raw-content host is slow or the TCP connection stalls (no response, no close), `git turn cost` hangs indefinitely with only the already-cleared `Fetching pricing data...` message on screen, giving the user no indication anything is wrong and no way to know when/if to give up.
**Fix:**
```js
const req = https.get(PRICING_URL, res => { ... });
req.setTimeout(10_000, () => req.destroy(new Error('pricing fetch timed out')));
req.on('error', reject);
```

## Info

### IN-01: Dead duplicate candidate in `lookupPrice()`

**File:** `src/commands/cost.js:49-54`
**Issue:** The `candidates` array lists bare `model` twice (index 0 and index 3):
```js
const candidates = [
  model,
  model.replace(/^(eu|us|ap|au)\./i, 'anthropic.'),
  `anthropic.${model}`,
  model,
];
```
The final entry is unreachable — it's identical to the first and the loop already returns/continues past it.
**Fix:** Remove the trailing duplicate `model` entry.

### IN-02: Head-sha-from-snapshot-message resolution logic duplicated across four files

**File:** `src/commands/show.js:24-25`, `src/commands/log.js:53-55`, `src/commands/cost.js:116-117`, `src/commands/redact.js:40-41`
**Issue:** All four files independently do:
```js
const { headSha } = parseSnapshotMessage(sha);
const head = headSha || sha;
```
followed by the identical explanatory comment about notes never carrying a `head` field. This is already correctly factored as a shared *parser* (`parseSnapshotMessage` in `blame-util.js`), but the "resolve real head, falling back to snapshot sha" policy itself is copy-pasted four times, which is exactly the kind of duplication that let the pre-fix bug (looking up notes by the bare snapshot sha) exist for three call sites before being caught.
**Fix:** Extract a single helper, e.g. `resolveHeadSha(sha)` in `blame-util.js`, and have all four commands call it.

### IN-03: Inconsistent case-sensitivity between the two "strip region prefix" regexes in `cost.js`

**File:** `src/commands/cost.js:51` vs `src/commands/cost.js:130`
**Issue:** The lookup-candidate regex uses the `i` flag (`/^(eu|us|ap|au)\./i`) while the display-normalization regex does not (`/^(eu|us|ap|au)\.anthropic\./`). Both regexes exist to recognize the same class of model-id prefixes; the mismatched case-sensitivity is an easy source of future drift (e.g. an upstream model id arriving as `US.anthropic....` would display-normalize incorrectly while still (mis)matching the lookup candidate).
**Fix:** Make both regexes consistent (either both case-insensitive or both not), ideally by sharing one prefix-stripping helper (see IN-02's suggested refactor pattern).

### IN-04: `gc --keep-sessions` accepts negative values without validation

**File:** `src/commands/gc.js:60-68`
**Issue:** `keepN` is validated only with `isNaN(keepN)`; a negative value like `--keep-sessions -1` passes validation and is silently accepted. `Math.max(0, allSessions.length - keepN)` then evaluates to `allSessions.length + 1`, which `Array.prototype.slice` just clamps to `allSessions.length` — so this happens to degrade gracefully to "delete everything (except the current session)" rather than crashing, but that behavior is accidental, not intentional, and isn't documented anywhere as the meaning of a negative `--keep-sessions`.
**Fix:**
```js
if (isNaN(keepN) || keepN < 0) {
  console.error('git turn gc: --keep-sessions requires a non-negative number');
  process.exit(1);
}
```

### IN-05: `gc.js` re-requires `../git` inside the `--purge-notes` branch even though it's already imported at the top of the file

**File:** `src/commands/gc.js:32`
**Issue:** `gc.js` already does `const { listRefs, deleteRef, gitSafe } = require('../git');` at the top of the file (line 3), but the new `--purge-notes` branch does a second, redundant `require('../git')` just to pull `purgeNotesHistory`. This mirrors the existing `--rebuild` branch's pattern of lazily requiring `../cache`, so it's consistent with local convention, but for `../git` specifically (already loaded, no lazy-load rationale like avoiding pulling in `node:sqlite` applies) it's unnecessary indirection.
**Fix:** Add `purgeNotesHistory` to the top-level destructure: `const { listRefs, deleteRef, gitSafe, purgeNotesHistory } = require('../git');` and drop the inline require.

---

_Reviewed: 2026-09-21T13:22:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 06-verification-redact-command-purge-procedure
fixed_at: 2026-09-21T13:27:04Z
review_path: .planning/phases/06-verification-redact-command-purge-procedure/06-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-09-21T13:27:04Z
**Source review:** .planning/phases/06-verification-redact-command-purge-procedure/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (critical + warning; fix_scope = critical_warning)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: `lookupPrice()`'s region-prefix candidate produces an unmatchable key, breaking Bedrock cost lookup

**Files modified:** `src/commands/cost.js`
**Commit:** 99a3bc5
**Applied fix:** Changed the second pricing-lookup candidate from `model.replace(/^(eu|us|ap|au)\./i, 'anthropic.')` (which replaced the region prefix, producing an unmatchable `anthropic.anthropic.X` key) to `model.replace(/^(eu|us|ap|au)\.(?=anthropic\.)/i, '')`, which strips the prefix entirely, matching the litellm pricing table's actual key shape. Also removed the dead duplicate trailing `model` entry in the candidates array (folds in IN-01, which was part of the same array literal REVIEW.md's own fix suggestion touched).

### WR-01: `computeCost()` can silently poison the running total with `NaN`

**Files modified:** `src/commands/cost.js`
**Commit:** b5c782d
**Applied fix:** Extended the pricing-entry validation in `lookupPrice()` from `entry && entry.input_cost_per_token` to also require `entry.output_cost_per_token != null`, so an incomplete upstream pricing entry causes the candidate to be skipped instead of producing `NaN` that would silently corrupt the total-cost accumulator.

### WR-02: `redact.js` does not catch `updateNote()` failures, unlike the cache-update call two lines below

**Files modified:** `src/commands/redact.js`
**Commit:** 31141c0
**Applied fix:** Wrapped the `updateNote(NOTES_REF, noteSha, ...)` call in a try/catch that prints `git turn: redact failed: {message}` and calls `process.exit(1)`, matching the clean CLI-error pattern already used elsewhere in the file, instead of letting a concurrent-write retry exhaustion crash with a raw Node stack trace.

### WR-03: `purgeNotesHistory()` / `gc --purge-notes` has no error handling around `git gc --prune=now`

**Files modified:** `src/commands/gc.js`
**Commit:** 5190c1d
**Applied fix:** Wrapped the `purgeNotesHistory(NOTES_REF)` call site in `gc.js`'s `--purge-notes` branch in a try/catch. On failure it now reports `git turn gc: notes ref rewritten but pruning failed: {message}` plus a follow-up line noting the old note blob may still be reachable, and exits with code 1, instead of surfacing an uncaught exception after the ref rewrite has already happened.

### WR-04: `fetchPricing()` has no request timeout

**Files modified:** `src/commands/cost.js`
**Commit:** 9a8117b
**Applied fix:** Captured the `https.get()` return value as `req`, added `req.setTimeout(10_000, () => req.destroy(new Error('pricing fetch timed out')))`, and moved the `error` listener onto `req`, so a stalled connection now fails after 10s with a clear error instead of hanging `git turn cost` indefinitely.

## Skipped Issues

None — all in-scope findings were fixed.

_Note: IN-01 through IN-05 (Info-tier findings) are out of scope for this run (fix_scope = critical_warning) and were not addressed._

---

_Fixed: 2026-09-21T13:27:04Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

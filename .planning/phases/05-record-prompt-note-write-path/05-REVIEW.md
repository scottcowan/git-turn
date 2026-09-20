---
phase: 05-record-prompt-note-write-path
reviewed: 2026-09-20T22:57:01Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/git.js
  - src/git.test.js
  - src/cache.js
  - src/cache.test.js
  - src/commands/record-prompt.js
  - src/commands/record-prompt.test.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-20T22:57:01Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the new `record-prompt` command, the `updateNote` read-merge-write helper added to `src/git.js`, and the `updatePromptFields`/`usage`/`tool_summary` additions to `src/cache.js`, along with their test suites. The diff against `317d971f` was used to scope the review to what actually changed in this phase (the CAS-style note retry loop, the new cache columns/migration, and the `record-prompt` command itself); pre-existing code in `git.js`/`cache.js` untouched by this phase (e.g. `writeBlob`/`readBlob`, the `upsertTurn` prompt/model/latency extraction) was only flagged where the new feature directly interacts with a latent defect in it.

No blockers were found — the core merge-not-overwrite and TOCTOU-retry design in `updateNote` is sound and matches its test coverage. The main gap is an input-validation asymmetry in `record-prompt.js`: `prompt` and `usage` are type-checked before being handed to the SQLite cache layer, but `model` and `tool_summary` are not, and `node:sqlite`'s parameter binding throws when given a non-primitive (confirmed empirically: passing an object/array as a bind parameter throws `Unknown named parameter '<key>'`). Because the cache write is wrapped in a blanket `catch {}`, a malformed `model`/`tool_summary` value silently desyncs the cache from the git note while the command still reports success on stdout.

## Warnings

### WR-01: `model` and `tool_summary` are not type-validated before being bound as SQLite parameters, causing a silent cache/note desync

**File:** `src/commands/record-prompt.js:65-102`
**Issue:** `payload.prompt` (lines 53-63) and `payload.usage` (lines 65-70) are explicitly validated to be the correct JS type before use, but `payload.model` and `payload.tool_summary` are not validated at all. If a caller sends `{"model": {...}}` or `{"tool_summary": [1,2,3]}` on stdin, the value is spread unchanged into the git note (`updateNote`, lines 84-91) — which succeeds, because the note is just JSON-serialized text — but then `updatePromptFields()` (`src/cache.js:241-261`) passes the raw object/array straight to `stmt.run(...)` as a bind parameter. `node:sqlite`'s `DatabaseSync` interprets non-primitive parameters as *named-parameter objects* and throws (verified: `db.prepare(...).run({foo:1})` → `Unknown named parameter 'foo'`; same for arrays, keyed by index). That throw is caught by the blanket `try { ... } catch {}` in `record-prompt.js:93-102`, so the cache silently fails to update while the note now holds a non-string `model`/`tool_summary`, and the command's `console.log` on line 104 still reports `model`/`tool_summary` as "recorded" even though the cache row was left stale. This produces an unrecoverable, invisible inconsistency between the source-of-truth note and the read cache — exactly the class of defect `ensureCache()`/`rebuild()` won't detect either, since rebuild re-derives from the (now-polluted) note and will hit the same throw during `upsertTurn`'s bind, but there `upsertTurn` isn't wrapped in try/catch and will raise inside `rebuild()`'s per-session transaction, aborting the whole rebuild for every session sharing that DB write (see `rebuild()` in `src/cache.js:179-209`, which only wraps `BEGIN`/`COMMIT`/`ROLLBACK`, not a `catch` around the throw before it re-throws at line 207).
**Fix:**
```javascript
if (payload.model !== undefined && typeof payload.model !== 'string') {
  console.error('git turn: model must be a string');
  process.exit(1);
}

if (payload.tool_summary !== undefined) {
  if (payload.tool_summary === null || typeof payload.tool_summary !== 'object' || Array.isArray(payload.tool_summary)) {
    console.error('git turn: tool_summary must be a JSON object');
    process.exit(1);
  }
}
```
Add these checks alongside the existing `prompt`/`usage` validation (before line 72), so every field that ends up bound to SQLite is validated the same way `prompt`/`usage` already are.

### WR-02: Cache write failure is swallowed with no diagnostic, masking real bugs (including WR-01)

**File:** `src/commands/record-prompt.js:93-102`
**Issue:** `try { const { updatePromptFields } = require('../cache'); updatePromptFields(...); } catch {}` discards the error entirely — not even a `process.stderr.write` for visibility. The design intent ("best-effort metadata-only update", per the comment on `updatePromptFields` in `src/cache.js:233-240`) is reasonable for the case where the cache DB is genuinely unavailable (e.g. `node:sqlite` unsupported on an older Node), but the same blanket catch also hides genuine defects like WR-01, type errors, or disk-full/corruption conditions with zero trace for a user or operator trying to debug why `git turn log`/cache queries don't reflect a recorded prompt.
**Fix:** At minimum, log the swallowed error to stderr (without failing the command, to preserve best-effort semantics):
```javascript
try {
  const { updatePromptFields } = require('../cache');
  updatePromptFields(session.session_id, latest.turn_n, { ... });
} catch (e) {
  process.stderr.write(`git turn: warning: cache update failed (${e.message})\n`);
}
```

### WR-03: `upsertTurn`'s falsy-coalescing on `latency_ms`/`prompt`/`model` zeroes out legitimate falsy values on rebuild

**File:** `src/cache.js:86-88`
**Issue:** `const latency_ms = meta?.latency_ms || null;` uses `||`, not `??`. A legitimately-recorded `latency_ms: 0` (a genuinely instantaneous turn) is coerced to `null` on every `rebuild()`/`insertTurn()` pass, silently losing data that `record-prompt`'s own `updatePromptFields` (which correctly uses `??` at `src/cache.js:253-257`) would have preserved. This is pre-existing code, but this phase is what makes `latency_ms` a first-class, user-supplied field via `record-prompt`, so the asymmetry between the two code paths (`updatePromptFields` uses `??`, `upsertTurn` uses `||`) is now directly reachable: record a turn with `latency_ms: 0`, run `git turn cache rebuild`, and the value silently reverts to `null`. The same `||` issue applies to `prompt`/`model` for the (rarer) case of an intentionally empty string.
**Fix:**
```javascript
const prompt = meta?.prompt ?? null;
const model = meta?.model ?? null;
const latency_ms = meta?.latency_ms ?? null;
```

## Info

### IN-01: `updateNote`'s lazy `require('../cache')` inside `record-prompt.js` is inconsistent with the rest of the file's top-level imports

**File:** `src/commands/record-prompt.js:94`
**Issue:** All other dependencies (`fs`, `updateNote`, `readSession`, `redact`, etc.) are required at module top; `cache` is required lazily inside the function body for no apparent functional reason (it isn't conditionally needed, and `cache.js`'s own `node:sqlite` import already happens unconditionally whenever `../cache` is loaded anywhere else in the process, e.g. by other commands). This is a minor inconsistency that makes the dependency graph harder to see at a glance.
**Fix:** Move `const { updatePromptFields } = require('../cache');` to the top of the file with the other imports, unless there's a documented reason (e.g. deferring the `node:sqlite` experimental-warning suppression side effect in `cache.js:8-11`) — if that's the reason, add a comment explaining it.

### IN-02: No upper bound or sanity check on `latency_ms` allows negative or absurd values into both the note and the cache

**File:** `src/commands/record-prompt.js:65-70` (contrast with the `usage`/`prompt` checks)
**Issue:** `payload.latency_ms` is passed through unchecked — it isn't required to be a number, let alone a non-negative one. A caller could send `{"latency_ms": "fast"}` or `{"latency_ms": -1}`; the former stores a string into a column that's meant to be numeric (SQLite's dynamic typing means this doesn't throw, but downstream consumers of `getTurns()`/`getAllTurns()` that assume `row.latency_ms` is numeric — e.g. any future average/percentile calculation — would silently misbehave).
**Fix:**
```javascript
if (payload.latency_ms !== undefined && (typeof payload.latency_ms !== 'number' || !Number.isFinite(payload.latency_ms) || payload.latency_ms < 0)) {
  console.error('git turn: latency_ms must be a non-negative number');
  process.exit(1);
}
```

---

_Reviewed: 2026-09-20T22:57:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

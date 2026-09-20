---
phase: 05-record-prompt-note-write-path
verified: 2026-09-20T23:08:45Z
status: passed
score: 15/15 must-haves verified
overrides_applied: 0
---

# Phase 5: record-prompt Note Write Path Verification Report

**Phase Goal:** `git turn record-prompt` lets a user attach prompt/model/latency/usage/tool-summary metadata to the current turn's note, safely and without clobbering what the post-commit hook already wrote.
**Verified:** 2026-09-20T23:08:45Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `updateNote()` in `src/git.js` preserves hook-written fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`) on a merge write | VERIFIED | `src/git.js:187-205`; `src/git.test.js` test 1 passes; manual E2E: note after `record-prompt` retains all 4 hook fields verbatim |
| 2 | A second `updateNote()` call adds/overwrites only patchFn-provided fields, leaving earlier fields intact (D-03) | VERIFIED | `src/git.test.js` test 2 passes (6/6 green) |
| 3 | Note changes between read and write cause the merge to re-run, not clobber | VERIFIED | `src/git.js` re-reads (`justBeforeWrite`) before writing and `continue`s on mismatch; `src/git.test.js` test 5 (race re-run) passes |
| 4 | Exhausting the retry budget throws loudly (`changed concurrently`) rather than silently overwriting | VERIFIED | `src/git.js:196-198`; `src/git.test.js` test 6 passes |
| 5 | Pre-v0.3 `cache.db` gains `usage`/`tool_summary` columns on next open without losing rows | VERIFIED | `src/cache.js:27-39` guarded `ALTER TABLE`; `src/cache.test.js` test 3 (legacy upgrade) passes |
| 6 | Repeated cache opens are a no-op after first migration (no duplicate-column crash) | VERIFIED | `/duplicate column name/i` catch guard; migration runs before `return _db` and outside the `if (_db) return _db` early-return (confirmed by line order: 42 → 74 → 75); `src/cache.test.js` test 2 passes |
| 7 | Rebuild from notes carrying `usage`/`tool_summary` persists both as JSON text on the turn row | VERIFIED | `upsertTurn()` serializes both fields (`src/cache.js:89-90`); `src/cache.test.js` test 4 passes |
| 8 | `updatePromptFields()` writes only supplied fields, others preserved (D-03 at SQL layer) | VERIFIED | `COALESCE(?, column)` per field, `src/cache.js:243-259`; `src/cache.test.js` tests 6-7 pass |
| 9 | Piping a JSON payload to `record-prompt` attaches prompt/model/usage/latency_ms/tool_summary to the latest turn's note | VERIFIED | Manual E2E in a real repo: `echo '{"prompt":...,"usage":{...},"latency_ms":1234,"tool_summary":{"Read":2}}' \| git-turn record-prompt` produced a note containing all fields; `record-prompt.test.js` tests 1, 4, 5, 6 pass |
| 10 | Target is always the latest turn via `listTurns()`/`parseSnapshotMessage()`, never bare HEAD; hook fields survive | VERIFIED | `src/commands/record-prompt.js:84-90` (no `headSha()` call — grep confirms 0 matches); `record-prompt.test.js` test 3 passes |
| 11 | A second `record-prompt` call adds fields without erasing the first call's fields | VERIFIED | `record-prompt.test.js` test 2 passes |
| 12 | A secret pasted into `prompt` is replaced with `[REDACTED]` and the count is reported on stderr | VERIFIED | `record-prompt.js:58-62` calls `redact(payload.prompt)` on the raw string, writes count to `process.stderr`; `record-prompt.test.js` test 7 passes |
| 13 | `usage` is stored verbatim in Anthropic's four-key shape so `git turn cost` can price it | VERIFIED | No usage-shape mutation in `record-prompt.js`; `record-prompt.test.js` test 4 (`deepEqual`) passes |
| 14 | Malformed JSON, non-string prompt, non-object usage, missing stdin, no-turns-yet all fail loudly on stderr with exit 1 | VERIFIED | `record-prompt.js:34-94`; manual checks confirm exit 1 + `git turn: ` stderr messages for malformed JSON, non-string prompt, non-object usage; `record-prompt.test.js` tests 9-13 pass |
| 15 | `git turn record-prompt` is a recognized command and appears in `git turn --help` | VERIFIED | `bin/git-turn:8` COMMANDS array includes `'record-prompt'`; `node bin/git-turn --help` output confirmed to include the `record-prompt` line |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/git.js` | `updateNote(ref, commitSha, patchFn, opts)` exported alongside `addNote`/`getNote` | VERIFIED | Function present lines 187-205; exported in `module.exports` line 220 |
| `src/git.test.js` | node:test coverage for merge, re-call merge, race retry, retry exhaustion | VERIFIED | 133 lines, 6 `test(` cases, all green |
| `src/cache.js` | `migrateSchema()` guarded ALTER TABLE, extended `upsertTurn()`, new `updatePromptFields()` | VERIFIED | All three present and wired; module.exports includes `updatePromptFields` |
| `src/cache.test.js` | node:test coverage for migration idempotency, legacy upgrade, upsert round-trip, COALESCE merge | VERIFIED | 223 lines, 7 `test(` cases, all green |
| `src/commands/record-prompt.js` | stdin JSON in, merged note + best-effort cache write out | VERIFIED | 121 lines, `function run` present, wired via `bin/git-turn` |
| `src/commands/record-prompt.test.js` | node:test coverage for CAPTURE-01..04, redaction, failure paths | VERIFIED | 233 lines, 13 `test(` cases, all green |
| `bin/git-turn` | `record-prompt` registered in COMMANDS and documented in `--help` | VERIFIED | Confirmed via grep and live `--help` run |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/git.js updateNote` | `src/git.js getNote` | read-before-merge, re-read-before-write | WIRED | Two `getNote(ref, commitSha)` calls per attempt |
| `src/git.js updateNote` | `src/git.js addNote` | single final write of merged JSON | WIRED | `addNote(ref, commitSha, patchedJSON)` on success path only |
| `src/git.js module.exports` | `updateNote` | named export | WIRED | Confirmed in exports object |
| `src/cache.js openDb` | `src/cache.js migrateSchema` | call after CREATE TABLE, before return | WIRED | Line order 42 (`if (_db) return _db`) → 74 (`migrateSchema(_db)`) → 75 (`return _db`) |
| `src/cache.js updatePromptFields` | `turns` table | prepared UPDATE with COALESCE per column | WIRED | Confirmed SQL text |
| `src/commands/record-prompt.js` | `src/git.js updateNote` | only note write in the command | WIRED | `updateNote(NOTES_REF, headSha, ...)`; no `addNote` import (grep = 0) |
| `src/commands/record-prompt.js` | `src/redact.js redact` | redaction before merge/stringify | WIRED | `redact(payload.prompt)` runs on raw string before any merge |
| `src/commands/record-prompt.js` | `src/session.js listTurns` + `src/blame-util.js parseSnapshotMessage` | turn-index target resolution, never bare HEAD | WIRED | Confirmed; `headSha()` call count = 0 |
| `src/commands/record-prompt.js` | `src/cache.js updatePromptFields` | best-effort try/catch cache update | WIRED | try/catch present with stderr diagnostic (post-review-fix) |
| `bin/git-turn` | `src/commands/record-prompt.js` | COMMANDS array entry | WIRED | `'record-prompt'` present in array and dispatched correctly (manual test) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| End-to-end note merge preserves hook fields | `git init` + `git-turn init` + commit + `record-prompt` piped JSON, then `git notes --ref=git-turn show HEAD` | Note contains `session_id`/`turn_n`/`snapshot_sha`/`ts` (hook) plus `prompt`/`model`/`usage`/`latency_ms`/`tool_summary` (record-prompt) | PASS |
| Malformed JSON on stdin | `echo 'not json' \| git-turn record-prompt` | exit 1, `git turn: invalid JSON on stdin: ...` | PASS |
| Non-string prompt | `echo '{"prompt":42}' \| git-turn record-prompt` | exit 1, `git turn: prompt must be a string` | PASS |
| Non-object usage | `echo '{"usage":"x"}' \| git-turn record-prompt` | exit 1, `git turn: usage must be a JSON object` | PASS |
| `--help` lists record-prompt | `node bin/git-turn --help \| grep record-prompt` | Line present | PASS |
| Full automated suite | `npm test` | 193/193 pass, 0 fail | PASS |
| Phase-specific suites | `node --test src/git.test.js src/cache.test.js src/commands/record-prompt.test.js` | 26/26 pass (6 + 7 + 13) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CAPTURE-01 | 05-01, 05-03 | `record-prompt` attaches metadata without clobbering hook fields; merge-write with retry; turn-index target, never bare HEAD | SATISFIED | `updateNote()` + `record-prompt.js` turn resolution; tests + manual E2E |
| CAPTURE-02 | 05-02, 05-03 | `usage` written in exact Anthropic-shape schema | SATISFIED | Verbatim pass-through, `deepEqual` test, manual E2E |
| CAPTURE-03 | 05-02, 05-03 | `latency_ms` captured when caller supplies it | SATISFIED | Passed through verbatim to note + cache; test 5 |
| CAPTURE-04 | 05-02, 05-03 | Tool-call count/name summary attachable alongside prompt metadata | SATISFIED | `tool_summary` round-trips through note and cache (D-04); test 6 |

No orphaned requirements — `.planning/REQUIREMENTS.md` maps only CAPTURE-01..04 to Phase 5, and all four are claimed across plans 01-03 and satisfied above.

**Note (non-blocking, informational):** `REQUIREMENTS.md` still shows CAPTURE-01..04 as `[ ]` unchecked / "Pending" in its tracking table. This is a documentation-lag artifact — the codebase evidence above establishes the requirements are functionally satisfied — but the tracking table should be updated to "Complete" at milestone bookkeeping time.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER found in `src/git.js`, `src/cache.js`, `src/commands/record-prompt.js`, or `bin/git-turn` | — | None |

The single `not yet implemented` grep hit in `bin/git-turn:44` is the pre-existing generic dispatcher fallback for genuinely unregistered commands — unrelated to `record-prompt`, which is registered and fully implemented.

Code review (`05-REVIEW.md`) found 3 warnings (WR-01, WR-02, WR-03) and 2 info items during phase execution; all 3 warnings were fixed and verified in `05-REVIEW-FIX.md` (commits `6c67819`, `a080ca8`), and independently re-confirmed in this verification pass by reading the current `record-prompt.js` (model/tool_summary type validation present, non-empty catch with stderr diagnostic present) and `cache.js` (`??` coalescing in `upsertTurn`, not `||`). The two `info`-level items (IN-01 lazy require placement, IN-02 no latency_ms sanity bound) were explicitly out of fix scope and remain open as minor, non-blocking style/robustness notes — not must-haves for this phase's goal.

### Human Verification Required

None. This phase is entirely backend/CLI: stdin-JSON-in, git-notes/SQLite-out, with no UI, visual, or asynchronous/external-service behavior. All must-haves were verified programmatically via automated tests, source inspection, and a live manual end-to-end run against a real git repository.

### Gaps Summary

No gaps. All 15 derived observable truths (roadmap goal + PLAN frontmatter must-haves across all 3 plans) are verified against actual code, not SUMMARY.md claims. `updateNote()` exists and is exhaustively tested for merge/race/retry-exhaustion behavior; the cache schema migrates additively and idempotently; `record-prompt` validates strictly before any write, redacts unconditionally, targets the turn index (never bare HEAD), and is registered/documented. The full 193-test suite and all 3 phase-specific test files (26 tests) pass with zero failures. A live manual run against a freshly initialized repository confirmed the hook's forensic fields survive a `record-prompt` merge write exactly as CAPTURE-01 requires. Code-review warnings raised during execution were fixed and the fixes are present and correct in the current codebase, independently re-verified here rather than trusted from the fix report alone.

---

_Verified: 2026-09-20T23:08:45Z_
_Verifier: Claude (gsd-verifier)_

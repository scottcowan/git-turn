---
phase: 05-record-prompt-note-write-path
plan: 03
subsystem: cli
tags: [git-notes, sqlite, cli, secret-redaction, tdd]

# Dependency graph
requires:
  - phase: 05-record-prompt-note-write-path (plan 01)
    provides: updateNote(ref, commitSha, patchFn, opts) read-merge-write helper in src/git.js
  - phase: 05-record-prompt-note-write-path (plan 02)
    provides: updatePromptFields(sessionId, turnN, {...}) COALESCE-merge cache writer in src/cache.js
  - phase: 04-secret-redaction
    provides: src/redact.js redact(text) -> { text, count }
provides:
  - "git turn record-prompt — the CLI writer that merges prompt/model/usage/latency_ms/tool_summary into the latest turn's note"
  - "bin/git-turn COMMANDS registration + --help text for record-prompt"
  - "AGENTS.md documentation of the new write path, replacing the stale 'nothing writes them yet' claim"
affects: [phase-6-verification, log --with-prompts, show, cost]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validate-before-write CLI command: all payload validation (JSON parse, prompt type, usage type, turn resolution) happens strictly before the note write, so a rejected payload leaves the note byte-identical"
    - "Redact-before-merge: redact(payload.prompt) runs on the raw string before it's ever assembled into an object that gets JSON.stringify'd for the note or cache"

key-files:
  created:
    - src/commands/record-prompt.js
    - src/commands/record-prompt.test.js
  modified:
    - bin/git-turn
    - AGENTS.md

key-decisions:
  - "usage validation is validate-light (object vs. non-object only) per 05-RESEARCH.md Focus Q4 — cost.js already degrades missing sub-fields to 0, so stricter shape enforcement would reject legitimate partial usage payloads"
  - "tool_summary and model receive no redaction — closed enumerable vocabularies (Claude Code tool names, model identifiers), never freeform text, per 05-RESEARCH.md Focus Q5"
  - "latency_ms is accepted verbatim with no timestamp-diffing logic in this command — start/stop computation is the future hook-wrapper caller's job, explicitly out of scope this phase"

patterns-established:
  - "Pattern: stdin-JSON CLI command reads fd 0 synchronously via fs.readFileSync(0, 'utf8'), the zero-dependency idiom for a codebase with no prior stdin-reading command"

requirements-completed: [CAPTURE-01, CAPTURE-02, CAPTURE-03, CAPTURE-04]

# Metrics
duration: 45min
completed: 2026-09-20
---

# Phase 5 Plan 03: record-prompt Note-Write Path Summary

**`git turn record-prompt` reads one JSON blob from stdin and merges prompt/model/usage/latency_ms/tool_summary into the latest turn's note via `updateNote()`, redacting the prompt through Phase 4's scanner and best-effort mirroring into the SQLite cache — the last missing writer in the v0.3 milestone.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-20T22:35:00Z (approx)
- **Completed:** 2026-09-20T23:20:00Z (approx)
- **Tasks:** 3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `src/commands/record-prompt.test.js` — 13 `node:test` cases covering CAPTURE-01 through CAPTURE-04, unconditional redaction, turn-index targeting (never bare HEAD), merge-not-overwrite across repeat calls, and every failure path (malformed JSON, empty stdin, non-string prompt, non-object usage, no turns yet)
- `src/commands/record-prompt.js` — synchronous CLI command that validates strictly before any write, redacts `prompt` before it touches any stringified payload, resolves the target turn via `listTurns()` + `parseSnapshotMessage()`, writes through `updateNote()` (never a blind overwrite), and best-effort mirrors into the cache via `updatePromptFields()`
- `record-prompt` registered in `bin/git-turn`'s `COMMANDS` array and `--help` text
- `AGENTS.md` gained a `### git turn record-prompt` section and the stale "nothing shipped writes them yet" storage-model claim was replaced with the current truth
- Full existing test suite (193 tests) passes with zero regressions; manual end-to-end verification against a real git-turn-initialized repo confirmed the hook's `session_id`/`turn_n`/`snapshot_sha`/`ts` fields survive a `record-prompt` merge write

## Task Commits

Each task was committed atomically as TDD RED/GREEN pairs, plus a docs task:

1. **Task 1: Write src/commands/record-prompt.test.js covering CAPTURE-01..04, redaction and failure paths (RED)** - `54707c0` (test)
2. **Task 2: Implement src/commands/record-prompt.js (GREEN)** - `8ceea96` (feat)
3. **Task 3: Register record-prompt in bin/git-turn and refresh AGENTS.md** - `49fb298` (docs)

_TDD plan: RED confirmed (module not found, 13/13 fail) before GREEN (13/13 pass, full suite 193/193 pass)._

## Files Created/Modified
- `src/commands/record-prompt.js` - New: stdin-JSON reader, validator, turn-index resolver, `updateNote()` call site, best-effort `updatePromptFields()` cache write, plain-text stdout confirmation
- `src/commands/record-prompt.test.js` - New: 13 `test(` cases inside `describe('record-prompt command', ...)`, `runWithStdin()`/`readNote()`/`seedHookNote()` fixture helpers
- `bin/git-turn` - Added `'record-prompt'` to `COMMANDS` array and a `--help` line
- `AGENTS.md` - New `### git turn record-prompt` subsection; storage-model bullet for `refs/notes/git-turn` updated to reflect the new write path

## Decisions Made
- Whole-object replacement for `usage`/`tool_summary` on each `record-prompt` call (not deep-merge across calls), matching the rest of the note's merge model — already resolved in 05-RESEARCH.md Open Question 1 and implemented at the SQL layer in plan 05-02
- `usage` validation stays permissive (object type check only) rather than enforcing the four Anthropic field names, so incremental/partial usage capture is never rejected
- No opt-out flag for redaction exists anywhere in the command, enforced by a grep gate in Task 2's acceptance criteria (`no-redact|skip-redact|--raw` returns 0 matches)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture didn't capture `process.stderr.write`, causing a false test failure**
- **Found during:** Task 2 (GREEN implementation, first test run)
- **Issue:** The plan's `redacts secrets in prompt before the note is written` test asserted against captured stderr, but the test's `runWithStdin()` helper (written in Task 1) only swapped `console.error`, not `process.stderr.write` — and the implementation (per the plan's own Task 2 action spec) writes the redaction notice via `process.stderr.write` directly, not `console.error`. The test failed with an empty-string match against the redaction regex.
- **Fix:** Added a `process.stderr.write` monkeypatch to `runWithStdin()` that appends to the same captured `err` array, restored in the `finally` block alongside the other swaps.
- **Files modified:** `src/commands/record-prompt.test.js`
- **Verification:** `node --test src/commands/record-prompt.test.js` — 13/13 pass after the fix; re-ran full suite (193/193) to confirm no other test relied on the old fixture behavior.
- **Committed in:** `8ceea96` (folded into Task 2's GREEN commit, since the fixture bug was only exposed by running the real implementation against it)

**2. [Rule 1 - Bug] A doc comment's literal substring tripped its own grep acceptance gate**
- **Found during:** Task 2 (acceptance-criteria verification)
- **Issue:** The module header comment originally read "this command never calls addNote() directly" — the literal substring `addNote` in that comment caused `grep -c 'addNote' src/commands/record-prompt.js` to return `1` instead of the required `0`, even though the implementation itself never imports or calls `addNote`. Same class of issue as plan 05-01's "lockfile" wording collision, documented in that plan's summary.
- **Fix:** Reworded the comment to "this command never performs a blind note-write call" — same meaning, no longer triggers the grep gate intended to catch an actual `addNote` import/call, not a comment describing its absence.
- **Files modified:** `src/commands/record-prompt.js`
- **Verification:** `grep -c 'addNote' src/commands/record-prompt.js` returns `0`; re-ran `node --test src/commands/record-prompt.test.js` (13/13) and `npm test` (193/193) to confirm the wording change had no behavioral effect.
- **Committed in:** `8ceea96` (folded into Task 2's GREEN commit, since the gate check happens before that commit closes)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - test/verification bugs, no production-behavior changes)
**Impact on plan:** Both fixes are test-infrastructure/wording corrections uncovered while satisfying the plan's own acceptance criteria. No scope creep; the shipped `record-prompt.js` behavior matches the plan's `<action>` spec exactly.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `git turn record-prompt` is fully wired end-to-end: CLI dispatch, validation, redaction, merge-write to notes, best-effort cache mirror, and documentation — CAPTURE-01 through CAPTURE-04 all complete
- Manually verified against a real `git turn init`-ed repo: `echo '{"prompt":"hi","usage":{"input_tokens":1}}' | git turn record-prompt` correctly reports `Turn 1: recorded prompt, usage` and the resulting note (`git notes --ref=git-turn show HEAD`) carries both the hook's original fields and the newly merged ones
- Full existing suite (193/193) green — no regressions introduced across the whole phase (plans 01, 02, 03)
- Remaining v0.3 milestone work per PROJECT.md: `--with-prompts` flag on `log`/`show` to surface captured prompt content, and the future Claude Code Stop-hook wrapper that actually constructs and pipes the JSON payload this command now knows how to receive — both explicitly out of scope for this phase
- No architectural blockers surfaced

## Self-Check: PASSED

- FOUND: src/commands/record-prompt.js
- FOUND: src/commands/record-prompt.test.js
- FOUND commit 54707c0 (test)
- FOUND commit 8ceea96 (feat)
- FOUND commit 49fb298 (docs)

---
*Phase: 05-record-prompt-note-write-path*
*Completed: 2026-09-20*

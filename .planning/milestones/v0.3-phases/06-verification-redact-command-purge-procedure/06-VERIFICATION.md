---
phase: 06-verification-redact-command-purge-procedure
verified: 2026-09-21T13:38:27Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 6: Verification / redact command / purge procedure Verification Report

**Phase Goal:** Captured prompt/model/usage data renders and prices correctly end-to-end through
the already-shipped read side, and there's a real remediation path for a secret that made it into
a note anyway.
**Verified:** 2026-09-21T13:38:27Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `show <N> --with-prompts` renders real captured prompt/model end-to-end | ✓ VERIFIED | `src/commands/show.js:24-25` resolves `headSha` via `parseSnapshotMessage(turn.sha)` before the notes lookup (was previously looking up by dangling snapshot sha); `--with-prompts` gate added at line 20/36; `show.test.js` 4/4 passing |
| 2 | `log --with-prompts` renders real captured prompt on both cache and `--no-cache` paths | ✓ VERIFIED | `src/commands/log.js:54-57` object-walk path now resolves `head` before the notes lookup; cache path (lines 20-42) untouched/already correct; `log.test.js` 3/3 passing covering both paths |
| 3 | `git turn cost` computes correct dollar costs from real captured usage end-to-end | ✓ VERIFIED | `src/commands/cost.js:117-118` resolves `head` via `parseSnapshotMessage` before notes lookup; `cost.test.js` 4/4 passing, network-free, HOME-scoped fixture |
| 4 | `git turn redact <N>` scrubs a turn's `prompt` field, leaves other fields intact, runs with no confirmation | ✓ VERIFIED | `src/commands/redact.js` — spread-merge `updateNote` write of `prompt: '[REDACTED]'` only, session-scoped lookup, no `readline`/stdin; `redact.test.js` 5/5 passing including per-field preservation and cache sync |
| 5 | `redact <N>` no-ops cleanly when there's no prompt to redact | ✓ VERIFIED | `redact.js:47-50` no-op guard before any write; `redact.test.js` Test 2 asserts no note mutation |
| 6 | `redact` is registered and documented in `bin/git-turn` help | ✓ VERIFIED | `node bin/git-turn --help` prints `redact <N>              Scrub a turn's captured prompt after the fact` |
| 7 | `gc --purge-notes` actually removes the pre-redaction note blob from the object store (`git cat-file -e` fails on old sha) | ✓ VERIFIED | `purgeNotesHistory()` in `src/git.js:231-259` implements collapse (parentless `commit-tree`) → `updateRef` → `gitSafe` reflog-expire → `git gc --prune=now`; `git.test.js` "purgeNotesHistory" suite (5 tests) asserts `cat-file -e <oldSha>` throws post-purge at the object-store level |
| 8 | Purge is safe on missing-reflog and missing-ref edge cases, and blast radius is warned/documented | ✓ VERIFIED | `purgeNotesHistory` returns `{purged:false, reason}` on missing ref (no throw); reflog-expire step uses `gitSafe` not `git`; `gc.js` prints 4-line stderr warning before purge; README.md/AGENTS.md document repository-wide blast radius and filter-repo/BFG non-applicability |
| 9 | Full test suite green, no regressions | ✓ VERIFIED | `npm test` → 217/217 pass, 0 fail (full run); targeted re-run of the 6 phase-touched test files → 35/35 pass |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/commands/show.js` | headSha resolution + `--with-prompts` gate | ✓ VERIFIED | Confirmed via read; `withPrompts` appears twice; notes lookup uses `head` |
| `src/commands/show.test.js` | first-ever e2e coverage, ≥60 lines | ✓ VERIFIED | 4/4 tests pass |
| `src/commands/log.js` | `--no-cache` object-walk headSha fix | ✓ VERIFIED | Confirmed via read; fix at line 54 precedes notes lookup at line 57 |
| `src/commands/log.test.js` | coverage of both prompt paths, ≥60 lines | ✓ VERIFIED | 3/3 tests pass |
| `src/commands/cost.js` | headSha resolution via `parseSnapshotMessage` | ✓ VERIFIED | `grep -c parseSnapshotMessage` = 2 (import + call); plus CR-01/WR-01/WR-04 review fixes applied |
| `src/commands/cost.test.js` | network-free e2e coverage, ≥70 lines | ✓ VERIFIED | 4/4 tests pass |
| `src/commands/redact.js` | post-hoc prompt scrub command, exports `run`, ≥40 lines | ✓ VERIFIED | 71 lines, exports `{ run }`, no `readline` |
| `src/commands/redact.test.js` | clear/preserve/no-op/bad-turn coverage, ≥60 lines | ✓ VERIFIED | 5/5 tests pass |
| `bin/git-turn` | `redact` registered + documented | ✓ VERIFIED | help text + COMMANDS array contain `redact` |
| `src/git.js` | `purgeNotesHistory(ref)` exported, uses `commit-tree` | ✓ VERIFIED | function present, exported, uses parentless `commit-tree` |
| `src/git.test.js` | object-store-level purge assertions incl. edge cases | ✓ VERIFIED | 5 new tests in `purgeNotesHistory` suite, all passing |
| `src/commands/gc.js` | `--purge-notes` flag dispatch + stderr warning | ✓ VERIFIED | branch present, warning printed before purge, try/catch added (WR-03) |
| `README.md` | documented purge procedure + blast radius + redact relationship | ✓ VERIFIED | "Remediating a leaked secret" section present, mentions filter-repo/BFG non-coverage and repository-wide blast radius |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `show.js` | `blame-util.js parseSnapshotMessage` | headSha resolution before notes lookup | ✓ WIRED | Confirmed at lines 24-28 |
| `log.js` | `blame-util.js parseSnapshotMessage` | headSha resolution in object-walk loop | ✓ WIRED | Confirmed at lines 54-57 |
| `cost.js` | `blame-util.js parseSnapshotMessage` | headSha resolution in turn loop | ✓ WIRED | Confirmed at lines 117-119 |
| `redact.js` | `git.js updateNote` | merge-not-overwrite write | ✓ WIRED | Confirmed at line 53, now wrapped in try/catch (WR-02) |
| `redact.js` | `blame-util.js parseSnapshotMessage` | headSha resolution before write target | ✓ WIRED | Confirmed at line 40 |
| `redact.js` | `cache.js updatePromptFields` | best-effort cache sync | ✓ WIRED | Confirmed at lines 60-61 |
| `gc.js` | `git.js purgeNotesHistory` | lazy require in `--purge-notes` branch | ✓ WIRED | Confirmed at line 34, wrapped in try/catch (WR-03) |
| `git.js purgeNotesHistory` | `git commit-tree` (no `-p`) | ancestor-chain severing | ✓ WIRED | Confirmed at lines 237-249, no parent arg in either primary or fallback path |
| `git.js purgeNotesHistory` | `gitSafe reflog expire` | non-fatal reflog expiry | ✓ WIRED | Confirmed at line 254, uses `gitSafe` not `git` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite integrity | `npm test` | 217 tests, 217 pass, 0 fail | ✓ PASS |
| Phase-touched test files | `node --test src/commands/show.test.js src/commands/log.test.js src/commands/cost.test.js src/commands/redact.test.js src/git.test.js src/commands/gc.test.js` | 35 tests, 35 pass, 0 fail | ✓ PASS |
| `redact <N>` help registration | `node bin/git-turn --help` | prints `redact <N>` and `gc --purge-notes` lines | ✓ PASS |
| No debt markers introduced | `grep TODO\|FIXME\|XXX\|TBD` across phase-touched command files | no matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| VERIFY-01 | 06-01 | `log --with-prompts` / `show --with-prompts` render real captured prompt/model/latency end-to-end | ✓ SATISFIED | show.js/log.js sha-resolution fix + `--with-prompts` gate, tests pass |
| VERIFY-02 | 06-02 | `git turn cost` computes correct dollar costs from real captured usage end-to-end | ✓ SATISFIED | cost.js sha-resolution fix + CR-01/WR-01/WR-04 pricing-correctness fixes, tests pass |
| REDACT-02 | 06-03 | `git turn redact <N>` lets a user manually scrub a specific turn's note content after the fact | ✓ SATISFIED | redact.js implemented, registered, tested, WR-02 error-handling fix applied |
| REDACT-03 | 06-04 | Documented purge procedure for already-written secret blobs | ✓ SATISFIED | purgeNotesHistory() + `gc --purge-notes` + README/AGENTS docs, WR-03 error-handling fix applied |

**Note:** `.planning/REQUIREMENTS.md` still shows these four requirements as unchecked (`[ ]`) with status "Pending" in its Traceability table. This is a documentation-bookkeeping gap, not a functional gap — codebase evidence (above) confirms all four are implemented, tested, and reviewed. Recommend updating REQUIREMENTS.md checkboxes as part of milestone close-out.

### Anti-Patterns Found

None found in phase-touched files (`show.js`, `log.js`, `cost.js`, `redact.js`, `gc.js`, `git.js`) — no `TODO`/`FIXME`/`XXX`/`TBD`, no placeholder returns, no empty handlers. A code-review pass (`06-REVIEW.md`) was run against this phase and found 1 critical + 4 warning issues (Bedrock pricing-key bug, NaN-poisoning risk, two missing-error-handling gaps, missing request timeout); all 5 were fixed in `06-REVIEW-FIX.md` (commits `99a3bc5`, `b5c782d`, `31141c0`, `5190c1d`, `9a8117b`) and confirmed present in the current codebase during this verification.

### Human Verification Required

None. All truths are verifiable via automated tests and direct code inspection; no visual/real-time/external-service behavior in scope for this phase beyond the already-tested, network-free pricing fixture.

### Gaps Summary

No functional gaps found. All four phase requirements (VERIFY-01, VERIFY-02, REDACT-02, REDACT-03) have real, tested, wired implementations, confirmed by re-running the full test suite (217/217 passing) and the phase-scoped test files (35/35 passing) directly rather than trusting SUMMARY.md claims. The one non-blocking administrative item is that `.planning/REQUIREMENTS.md`'s checkboxes/status column for these four requirements were not updated to reflect completion — noted above for milestone close-out, not treated as a gap against the phase goal.

---

_Verified: 2026-09-21T13:38:27Z_
_Verifier: Claude (gsd-verifier)_

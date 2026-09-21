# Phase 6: Verification, Redact Command & Purge Procedure - Research

**Researched:** 2026-09-21
**Domain:** git-notes read-path bugs, git object-model purge mechanics, zero-dependency Node CLI test design
**Confidence:** HIGH — every claim in this document is either (a) empirically verified by running real commands against a live throwaway git repo in this research session, or (b) verified by direct source reading of this repo's code. No training-data-only claims are used for the load-bearing findings.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Redact scope):** `git turn redact <N>` scrubs only the `prompt` field, replacing it with `[REDACTED]` (or clearing it). `model`/`usage`/`latency_ms`/`tool_summary` are left intact — those fields are structured/enumerable, not freeform text, so they're not where a leaked secret would realistically live.

**D-02 (Confirmation behavior):** Runs immediately, no confirmation prompt — consistent with git-turn's existing mutating commands (`revert`, `redo`), which don't ask for confirmation today.

**D-03 (Purge procedure exposure):** REDACT-03 ships as a real CLI flag, not documentation-only: `git turn gc --purge-notes` (or similar flag name, planner's call) actually runs the reflog-expire + `git gc --prune=now` sequence scoped to `refs/notes/git-turn`. Consistent with `gc.js`'s existing pattern (`--rebuild` already triggers a real cache rebuild, not just a doc pointer).

### Claude's Discretion
- Exact flag name for the purge command (`--purge-notes` vs alternatives) — planner's call, should read naturally in `--help` output.
- Whether `redact <N>` accepts a session-scoped turn number or requires session context like other commands (`show`, `diff`) already do — follow whatever convention `show.js`/`diff.js` already use for resolving `<N>` within the current session.
- `show.js`'s `--with-prompts` gating — flagged as unresolved in Phase 5's research. **This research resolves it — see Focus Question 6 below: ROADMAP.md's own Phase 6 success criteria literally reads `git turn show --with-prompts`, which settles this in favor of ADDING the flag gate, not keeping it unconditional.**

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope (per 06-CONTEXT.md).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VERIFY-01 | `log --with-prompts`/`show --with-prompts` render real captured data end-to-end | Focus Question 1 (CRITICAL BUG FOUND) — `show.js` and `log.js --no-cache` currently never find real notes; concrete fix + test design in Focus Questions 1 and 4 |
| VERIFY-02 | `cost` computes correct dollar costs from real `usage` data end-to-end | Focus Question 2 (SAME BUG) — `cost.js` has the identical sha-resolution defect; fix + test design (with a real, network-free pricing fixture) in Focus Questions 2 and 5 |
| REDACT-02 | `git turn redact <N>` manually scrubs a turn's note | Focus Question 3 — concrete module, turn-resolution convention, `updateNote()` reuse |
| REDACT-03 | Documented, real, verified purge procedure for `refs/notes/git-turn` | Focus Question 7 — empirically verified exact command sequence; PITFALLS.md's assumed sequence is INCOMPLETE, corrected here |
</phase_requirements>

## Summary

This research empirically disproves two assumptions the milestone research carried into this phase, both discovered by actually running the code against live throwaway repos rather than reading it.

**Finding 1 — VERIFY-01/VERIFY-02 will fail on the current code, not just need tests.** `show.js` and `cost.js` (and `log.js`'s `--no-cache` git-object-walk fallback) resolve a turn's note via `turn.sha` — the *snapshot* commit sha stored in the turn ref — but the post-commit hook and `record-prompt.js` both write notes on the real HEAD commit sha, which is a **different object**. Confirmed live: `git turn show 1` after a real `record-prompt` call prints `error: no note found for object <snapshot-sha>` to stderr and falls back to an empty header; `git turn cost` prints `(no model recorded)` even though a model was genuinely captured. `log --with-prompts` happens to work today only because its **default cache-backed path** looks up rows by `(session_id, turn_n)`, not by sha — the bug is fully masked in the common case and only surfaces via `--no-cache` or in `show`/`cost`, which have no cache path at all. This phase's "verification" work is therefore corrective, not just observational: `show.js` and `cost.js` must be patched to resolve the real head sha (`parseSnapshotMessage(turn.sha).headSha`, the exact pattern `record-prompt.js` already uses) before querying notes.

**Finding 2 — the milestone's assumed purge procedure (reflog-expire + `gc --prune=now`) does not remove the old note blob by itself.** Empirically verified: `refs/notes/git-turn` is a linear commit chain (each `git notes add -f` commits a new notes-tree commit with the *previous* notes commit as its parent). That means the prior version stays reachable as an **ancestor of the current ref tip** — reflog expiry is irrelevant to ancestor reachability. Running exactly PITFALLS.md's assumed sequence (`git reflog expire --expire=now refs/notes/git-turn` + `git gc --prune=now`) with no other change left the secret blob fully intact and `git cat-file -e` succeeding. The blob is only actually removed after an additional step: collapsing the notes-ref history to a single parentless commit (`git commit-tree <current-tree>` with no `-p`, then `git update-ref refs/notes/git-turn <new-commit>`) *before* the reflog-expire + gc. This has a real design consequence: **the purge is global to the whole `refs/notes/git-turn` ref, not scoped to one commit** — it discards *all* prior note history for *every* commit's note, not just the one containing the secret. Document this loudly; there is no way to purge one commit's note history in isolation while preserving another's.

**Primary recommendation:** Fix `show.js` and `cost.js`'s note-lookup sha resolution as part of this phase's VERIFY-01/VERIFY-02 work (this is required to make the success criteria true at all, not optional cleanup). Implement `git turn redact <N>` as a thin wrapper around the existing `updateNote()` merge helper, following `show.js`'s turn-resolution convention exactly. Implement `git turn gc --purge-notes` as a new `purgeNotesHistory()` helper in `src/git.js` that does history-collapse + reflog-expire (tolerating "no reflog" as non-fatal) + `git gc --prune=now`, and document its full-repo blast radius prominently. Resolve the `show.js --with-prompts` open question by adding the flag, per ROADMAP.md's own literal phrasing of the Phase 6 success criteria.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Note-read sha resolution (turn → real head commit) | CLI command (`show.js`/`cost.js`/`log.js`) | `blame-util.js` (`parseSnapshotMessage`) | Same helper `record-prompt.js` already uses for the write side; read side must use it too — this is the root cause of Finding 1 |
| `redact <N>` note mutation | CLI command (new `redact.js`) | `src/git.js` (`updateNote`) | Pure wiring — no new git plumbing needed, reuses Phase 5's merge helper |
| Notes-ref history collapse (purge) | `src/git.js` (new `purgeNotesHistory()`) | CLI command (`gc.js`, dispatch only) | Git plumbing (commit-tree/update-ref/reflog/gc) belongs next to `addNote`/`updateNote`, not in command logic |
| Verification tests (VERIFY-01/02) | `node:test` files under `src/commands/` | — | No server/network tier; all local process-level integration tests |

## Standard Stack

No new libraries. Zero-npm-dependency discipline maintained — `package.json` has no `dependencies` key and this phase adds none. All work is `node:child_process` (`execFileSync`, already in use via `src/git.js`) and `node:test` (already the project's only test framework).

### Package Legitimacy Audit

Not applicable — this phase installs no external packages. No slopcheck run needed.

## Architecture Patterns

### System Architecture Diagram — the bug and its fix

```
CURRENT (BROKEN) read path — show.js / cost.js / log.js --no-cache:

  listTurns(session_id) → { turn_n, sha: SNAPSHOT_SHA, ref }
                                  │
                                  ▼
              git notes --ref=git-turn show SNAPSHOT_SHA   ◄── WRONG OBJECT
                                  │
                                  ▼
                    "error: no note found" / meta = {}


CORRECT read path (matches record-prompt.js's write side):

  listTurns(session_id) → { turn_n, sha: SNAPSHOT_SHA, ref }
                                  │
                                  ▼
        parseSnapshotMessage(SNAPSHOT_SHA) → { headSha: REAL_HEAD_SHA }
                                  │
                                  ▼
              git notes --ref=git-turn show (REAL_HEAD_SHA || SNAPSHOT_SHA)
                                  │
                                  ▼
                    real prompt/model/usage/latency_ms data
```

```
Purge procedure (REDACT-03) — verified sequence, in this exact order:

  1. tree = git rev-parse refs/notes/git-turn^{tree}      (current visible content)
  2. newCommit = git commit-tree <tree> -m "purge"         (NO -p — severs ancestor chain)
  3. git update-ref refs/notes/git-turn <newCommit>         (ref now has NO history)
  4. git reflog expire --expire=now refs/notes/git-turn     (tolerate "reflog not found")
  5. git gc --prune=now                                     (actually deletes unreachable objects)

  Step 2's "no parent" is the load-bearing step. Skipping it (i.e. running only
  steps 4-5, which is what PITFALLS.md assumed) leaves the old blob reachable
  as an ancestor commit and gc --prune=now does NOT remove it — verified live.
```

### Recommended Project Structure
```
src/
├── commands/
│   ├── redact.js          # NEW — git turn redact <N>
│   ├── gc.js               # MODIFIED — add --purge-notes branch
│   ├── show.js             # MODIFIED — fix sha resolution bug + add --with-prompts gate
│   ├── cost.js              # MODIFIED — fix sha resolution bug
│   └── log.js               # MODIFIED — fix sha resolution bug in --no-cache fallback
├── git.js                   # MODIFIED — add purgeNotesHistory()
bin/git-turn                 # MODIFIED — register 'redact', update help text
```

---

## Focus Question 1: The `show.js`/`log.js --no-cache` note-lookup bug (VERIFY-01 root cause)

**Empirically confirmed this session** (live throwaway repo, real post-commit-hook-shaped note write + real `record-prompt` call, then `show`/`log --no-cache` invoked):

```
head: e523e5c... snapshotSha(turn.sha): 4037027d...
Turn 1: recorded prompt, model, usage

--- git turn log --with-prompts --no-cache ---
Session: 6943ac0e-...
  turn  1  e523e5c  turn 1
                                                            ← NO PROMPT LINE PRINTED

--- git turn show 1 ---
error: no note found for object 4037027d9491b3e94bcec4e9d92255c2d686c157.
Turn 1  e523e5c  01/01/1970, 01:00:00
[... diff output only, no model/latency/prompt lines ...]
```

**Root cause:** `show.js` line 21 and `log.js` line 52 (git-object-walk fallback) both call `gitSafe(['notes', '--ref='+NOTES_REF, 'show', sha])` where `sha` is `turn.sha` — the value from `listTurns()`, which reads `refs/git-turn/sessions/{id}/turn-{N}`, whose target is the **dangling snapshot commit** created by `snapshotWorktree()` (see `src/hooks/post-commit.js` lines ~33-42). The post-commit hook writes the note on `head` — the real `HEAD` commit sha *at commit time* — not on the snapshot commit. `record-prompt.js` correctly resolves this via `parseSnapshotMessage(latest.sha).headSha` before calling `updateNote()`. `show.js`/`cost.js`/`log.js`'s object-walk fallback never apply the same resolution before their *read*.

**Confirmed fix** (same live repo, same fixture, only the lookup changed):
```javascript
const { headSha: resolvedHead } = parseSnapshotMessage(turn.sha);
const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', resolvedHead || turn.sha]);
// → correctly returns the full note JSON including prompt/model/usage
```
Verified output: `note found via resolved head: {"session_id":...,"prompt":"why did this break","model":"claude-sonnet-4-5","usage":{...}}`.

**Why `log --with-prompts`'s default path "works" today:** `log.js`'s cache-backed branch (the default, no `--no-cache`) calls `getTurns(session_id)` from `src/cache.js`, which reads rows keyed by `(session_id, turn_n)` — the same key `record-prompt.js`'s `updatePromptFields()` writes to. This path never touches commit shas at all, so it's immune to the bug and was verified live to correctly print `prompt: why did this break...`. This is why the defect was never caught: the happy-path demo (`log --with-prompts` with a warm cache) genuinely works; only `show`, `cost`, and `log --no-cache` are broken.

**Required fix for this phase:** In `show.js` and `cost.js`, resolve `headSha` via `parseSnapshotMessage(turn.sha)` (already imported in both files for the diff/header display) and use `headSha || turn.sha` as the notes-lookup target, mirroring `record-prompt.js`'s exact pattern. In `log.js`'s git-object-walk fallback, apply the same fix (it already calls `parseSnapshotMessage(sha)` two lines below the broken notes lookup — just needs reordering so the resolved value is available before the notes call).

**Confidence:** HIGH — reproduced twice in this session with two independent live scripts, root-caused by direct source diff between `record-prompt.js` (correct) and `show.js`/`cost.js`/`log.js` (incorrect), fix verified to work live.

---

## Focus Question 2: `cost.js` has the identical bug (VERIFY-02 root cause)

**Empirically confirmed** — same live-repo test, `git turn cost` after a real `record-prompt` call with `model: "claude-sonnet-4-5"` and real `usage` data printed:
```
Turn   Model                Input   Output   Cost
    1  (no model recorded)      ?        ?      ?
```
`cost.js` line 115 does `gitSafe(['notes', ..., 'show', sha])` where `sha` comes straight from `listTurns()` (turn.sha, the snapshot sha) — same root cause as Focus Question 1, no `parseSnapshotMessage` call anywhere in `cost.js` today.

**Required fix:** add `const { parseSnapshotMessage } = require('../blame-util');` to `cost.js`'s imports, and resolve `headSha || sha` before the notes lookup, identical fix pattern to `show.js`.

**Separate, correctly-designed part of `cost.js` (no change needed):** `computeCost()`'s defensive-read arithmetic (`usage.input_tokens || 0` etc.) and `lookupPrice()`'s multi-candidate model-key matching are both already correct and match `record-prompt.js`'s Phase 5 research (Focus Question 4 there) — VERIFY-02's job on the *pricing arithmetic* side is genuinely just verification, not a fix. The bug is isolated entirely to the notes-lookup sha, not the cost computation.

**Confidence:** HIGH — same live verification session as Focus Question 1; fix pattern identical and independently confirmed to work (Focus Question 1's fix snippet applies verbatim).

---

## Focus Question 3: `git turn redact <N>` — concrete implementation

**Turn resolution convention:** Follow `show.js` exactly — `listTurns(session.session_id)`, `turns.find(t => t.turn_n === turnN)`, error `git turn: turn ${turnN} not found` + exit 1 if missing. This is session-scoped (current session only), matching `show.js`/`diff.js`, not cross-session like `blame.js`.

**Note-sha resolution:** Must apply the SAME fix as Focus Question 1 — resolve the real head sha via `parseSnapshotMessage(turn.sha)` before calling `updateNote()`, since `updateNote()`/`getNote()`/`addNote()` operate on whatever sha they're given and the note genuinely lives on the head sha, not the snapshot sha.

**Concrete module** (`src/commands/redact.js`, new):
```javascript
'use strict';

const { updateNote, getNote } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const turnN = parseInt(args[0], 10);
  if (isNaN(turnN)) {
    console.error('Usage: git turn redact <N>');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === turnN);
  if (!turn) {
    console.error(`git turn: turn ${turnN} not found`);
    process.exit(1);
  }

  const { headSha } = parseSnapshotMessage(turn.sha);
  const noteSha = headSha || turn.sha;

  const existingRaw = getNote(NOTES_REF, noteSha);
  let existing = {};
  try { existing = existingRaw ? JSON.parse(existingRaw) : {}; } catch { existing = {}; }

  if (!existing.prompt) {
    console.log(`Turn ${turnN}: no prompt recorded, nothing to redact`);
    return;
  }

  updateNote(NOTES_REF, noteSha, current => ({ ...current, prompt: '[REDACTED]' }));

  try {
    const { updatePromptFields } = require('../cache');
    updatePromptFields(session.session_id, turnN, { prompt: '[REDACTED]' });
  } catch {}

  console.log(`Turn ${turnN}: prompt redacted`);
}

module.exports = { run };
```

**Design notes:**
- Uses `'[REDACTED]'` (D-01's explicit choice), the same literal placeholder `src/redact.js`'s own automatic scanner uses — visual consistency between manual and automatic redaction.
- No-op (does not write) when there's no `prompt` field to redact — avoids growing the notes-ref history chain with a content-free commit (see Focus Question 7: every note write, including a no-op redact, appends to that linear chain).
- No confirmation prompt (D-02) — matches `revert.js`/`redo.js`'s existing immediate-execution style exactly (grepped, no `readline`/prompt library anywhere in `src/commands/`).
- Reuses `updateNote()` unchanged — no new git plumbing needed for this command, only the sha-resolution fix already required elsewhere.

**`bin/git-turn` registration:** add `'redact'` to the `COMMANDS` array and a help-text line: `  redact <N>              Scrub a turn's captured prompt after the fact`.

**Confidence:** HIGH — directly modeled on `show.js`'s exact turn-resolution code (read this session) and `record-prompt.js`'s exact `updateNote()` usage pattern (read this session).

---

## Focus Question 4: VERIFY-01 concrete test design

**No existing test files** — `src/commands/log.test.js` and `src/commands/show.test.js` do not exist in this repo (confirmed via `ls`, both `ENOENT`). This is the Wave 0 gap.

**Test pattern:** follow `record-prompt.test.js`'s existing structure exactly — `makeTestRepo()` for an isolated repo with `HOME` overridden, `startSession()` from `../helpers/turn-fixtures`, then hand-construct a real hook-shaped note (`addNote(NOTES_REF, headSha, ...)`, exactly as `record-prompt.test.js`'s own `seedHookNote()` helper already does), then call `record-prompt.js`'s real `run()` with monkeypatched stdin (copy the `runWithStdin()` helper from `record-prompt.test.js`), then call `show.js`/`log.js`'s real `run()` and assert on captured `console.log` output.

**Concrete assertions to write** (both must pass only after Focus Question 1's fix ships):
```javascript
// show.test.js (new)
test('show <N> renders real captured prompt/model/latency end-to-end', () => {
  // ... seed hook note + real record-prompt call via runWithStdin-style helper ...
  const out = captureConsoleLog(() => require('../commands/show').run(['1']));
  assert.match(out.join('\n'), /why did this break/);
  assert.match(out.join('\n'), /claude-sonnet-4-5/);
});

// log.test.js (new)
test('log --with-prompts --no-cache renders real captured prompt end-to-end', () => {
  const out = captureConsoleLog(() => require('../commands/log').run(['--with-prompts', '--no-cache']));
  assert.match(out.join('\n'), /prompt: why did this break/);
});

test('log --with-prompts (cache path) renders real captured prompt end-to-end', () => {
  // exercises the ALREADY-correct cache path — regression guard, not a bug-fix target
  const out = captureConsoleLog(() => require('../commands/log').run(['--with-prompts']));
  assert.match(out.join('\n'), /prompt: why did this break/);
});
```
Testing **both** the cache path and `--no-cache` path for `log.js` matters — they're two independent code paths with, today, two independent correctness states (one already works, one is broken), and a test suite that only exercises the default cache path would miss the exact defect this research found.

**Confidence:** HIGH — test scaffolding directly copied from `record-prompt.test.js`'s already-working, already-reviewed pattern (read this session); assertions are literal strings verified to appear/not-appear in this session's live repro output.

---

## Focus Question 5: VERIFY-02 concrete test design (network-free)

**The network problem:** `cost.js`'s `loadPricing()` fetches `https://raw.githubusercontent.com/BerriAI/litellm/...` unless a local cache file at `path.join(os.homedir(), '.git-turn-pricing.json')` is fresh (`CACHE_TTL_MS` = 1 week). Running this in CI/tests would be flaky and slow.

**The fix already exists in the test harness, unused so far:** `makeTestRepo()` (in `src/helpers/test-repo.js`) already overrides `env: { ...process.env, HOME: dir }` for every git call in the fixture, and `os.homedir()` resolves from `process.env.HOME` on POSIX. This means **pre-writing a fake pricing cache file at `join(dir, '.git-turn-pricing.json')` before invoking `cost.js`'s `run()` makes the pricing lookup fully deterministic and network-free** — `loadPricing()`'s `Date.now() - cached._fetched_at < CACHE_TTL_MS` check will short-circuit before ever calling `fetchPricing()`.

**Concrete test setup:**
```javascript
const { join } = require('path');
const { writeFileSync } = require('fs');

function seedFakePricing(dir, modelKey, priceEntry) {
  writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({
    _fetched_at: Date.now(),
    data: { [modelKey]: priceEntry },
  }));
}

// in the test:
seedFakePricing(dir, 'claude-sonnet-4-5', {
  input_cost_per_token: 0.000003,
  output_cost_per_token: 0.000015,
});
// ... seed hook note + real record-prompt call with model:'claude-sonnet-4-5', usage:{input_tokens:1000,output_tokens:500} ...
const out = await captureConsoleLogAsync(() => require('../commands/cost').run([]));
// expected: 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
assert.match(out.join('\n'), /\$0\.0105/);
```
`cost.js`'s `run()` is `async` (the one outlier command per Phase 5 research) — the test needs to `await` it or return the promise from the `test()` callback (`node:test` supports async test functions natively, no extra harness needed).

**Also required for this test to pass:** Focus Question 2's fix (`cost.js`'s note-lookup sha bug) — without it, `model`/`usage` are never found and this test fails on `(no model recorded)` regardless of pricing-fixture correctness. This is the concrete proof that VERIFY-02 as literally stated ("computes correct dollar costs from real captured usage data end-to-end") **cannot pass without the fix** — it is not possible to write a passing end-to-end test against the current `cost.js`.

**Confidence:** HIGH — `HOME` override mechanism read directly from `test-repo.js` source this session; pricing-cache short-circuit logic read directly from `cost.js` source this session; arithmetic double-checked by hand against `computeCost()`'s exact formula.

---

## Focus Question 6: `show.js --with-prompts` — resolved

**Resolution: ADD the flag gate to `show.js`, matching `log.js`.**

**Evidence, not just preference:** `.planning/ROADMAP.md` line 105 states this phase's own Success Criterion 1 as: *"`git turn log --with-prompts` and `git turn show --with-prompts` render real captured prompt/model/latency data end-to-end"* — the roadmap document itself, written before this research, already assumes `show` takes a `--with-prompts` flag. Currently it does not (verified by reading `show.js` source — no `args.includes('--with-prompts')` anywhere, `meta.prompt` is displayed unconditionally). Two options for reconciling:
1. Add the flag to `show.js`, gate the prompt-display block behind it (matches the roadmap's literal text).
2. Leave `show.js` unconditional and treat the roadmap's `--with-prompts` mention as a typo/copy-paste from `log`'s own flag.

Recommend (1): it costs one `args.includes()` check, it makes `show.js`'s behavior symmetrical with `log.js` (both hide prompt content by default, both reveal it with the same flag name), and it directly satisfies the literal wording of the phase's own locked success criteria rather than requiring the planner to silently reinterpret it. Default-hidden is also the safer default for a command whose output is more likely to be piped/shared/screenshotted (a full single-turn diff dump) than `log`'s summary table.

**Confidence:** HIGH for what the roadmap document says (read directly this session); MEDIUM for "this is definitely the intended resolution" (a reasonable but not the only possible reading) — flagged in Assumptions Log below.

---

## Focus Question 7: `git turn gc --purge-notes` — verified purge mechanics

**Empirically verified, in order, in this session** (three live repro attempts; the first two failed as documented, the third succeeded):

1. **Naive attempt (what PITFALLS.md assumed) — FAILED.** Wrote a note with a secret marker, overwrote it with a redacted version, then ran `git reflog expire --expire=now refs/notes/git-turn` followed by `git gc --prune=now`. Result: `git cat-file -e <old-blob-sha>` still succeeded — **the secret blob was NOT removed.**

2. **Root cause, verified.** `git log --format='%H %P' refs/notes/git-turn` showed the old notes-commit as the direct **parent** of the new notes-commit — `git notes add -f` always commits the new note-tree with the prior ref value as parent (this is what makes `git log refs/notes/git-turn` show note history at all). The old commit (and its blob) is therefore reachable via ordinary commit ancestry from the current ref tip, completely independent of the reflog. Reflog expiry only removes *dangling* history the ref used to point to and no longer does; it does nothing for history the ref's current tip still has as an ancestor.

3. **Working sequence — VERIFIED.**
   ```bash
   # Step 1: capture the current visible tree (this IS the redacted/correct state)
   TREE=$(git rev-parse refs/notes/git-turn^{tree})

   # Step 2: commit that tree with NO parent — severs the ancestor chain
   NEW=$(git commit-tree "$TREE" -m "git-turn: purge notes history")

   # Step 3: move the ref to the new, parentless commit
   git update-ref refs/notes/git-turn "$NEW"

   # Step 4: expire the ref's own reflog (removes the ref's OLD position as a
   # reflog-only reachability root)
   git reflog expire --expire=now refs/notes/git-turn

   # Step 5: actually delete now-unreachable objects
   git gc --prune=now
   ```
   Verified after this sequence: `git cat-file -e <old-blob-sha>` → fails (blob gone); `git cat-file -e <old-notes-commit-sha>` → fails (commit gone); `git notes --ref=git-turn show <sha>` → still returns the current (redacted) content correctly.

4. **Edge case, verified: missing reflog is a hard error, not a no-op.** `git reflog expire --expire=now <ref>` on a ref with **no reflog at all** (e.g. `core.logAllRefUpdates=false`, common in bare repos, or any repo where `refs/notes/git-turn` happens to have zero reflog entries) fails with `error: reflog could not be found: 'refs/notes/git-turn'` and **exit code 255** — this would crash `git()`'s `execFileSync` wrapper (which throws on nonzero exit) if called via `git()` rather than `gitSafe()`. **The implementation must call this step through `gitSafe()` (swallow the error) or explicitly check `git reflog exists <ref>` first** — a missing reflog is not a failure condition for the purge (step 3's ref move already did the reachability-severing work; step 4 is defense-in-depth, not load-bearing).

**Concrete implementation** (add to `src/git.js`, next to `updateNote`):
```javascript
// Collapse a notes ref's entire commit history to a single parentless
// commit holding its CURRENT tree, then expire its reflog and force a
// full-repo gc. This is the only way to actually remove an old note blob
// from the object store — overwriting a note (addNote -f) or even
// expiring the ref's reflog alone leaves the prior notes-commit reachable
// as an ordinary ancestor of the current tip (verified empirically,
// 06-RESEARCH.md Focus Question 7 — this is NOT the same failure mode
// reflog-expiry protects against).
//
// WARNING: `git gc --prune=now` operates on the WHOLE repository, not
// just this ref. Any other unreachable object in the repo (e.g. a
// dangling commit from `git stash` or another tool, with no ref/reflog
// protecting it) is also permanently deleted by this call. This is
// unavoidable — git has no way to scope object pruning to one ref's
// history — and must be documented prominently in --help/README, not
// just here.
function purgeNotesHistory(ref) {
  const currentSha = gitSafe(['rev-parse', ref]);
  if (!currentSha) {
    return { purged: false, reason: `ref ${ref} does not exist` };
  }

  const tree = git(['rev-parse', `${ref}^{tree}`]);
  const newCommit = git(
    ['commit-tree', tree, '-m', 'git-turn: purge notes history'],
    { env: { GIT_AUTHOR_NAME: 'git-turn', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'git-turn', GIT_COMMITTER_EMAIL: '' } }
  );
  updateRef(ref, newCommit);

  // Missing reflog is expected and non-fatal (e.g. core.logAllRefUpdates=false) —
  // step above already severed the ancestor chain, which is the load-bearing part.
  gitSafe(['reflog', 'expire', '--expire=now', ref]);

  git(['gc', '--prune=now']);

  return { purged: true, oldSha: currentSha, newSha: newCommit };
}
```

**`gc.js` dispatch addition** (mirrors the existing `--rebuild` branch exactly):
```javascript
if (args.includes('--purge-notes')) {
  const { purgeNotesHistory } = require('../git');
  const { NOTES_REF } = require('../session');
  console.error('git turn gc: this permanently deletes ALL unreachable objects in this');
  console.error('repository (git gc --prune=now is not scoped to notes) — including any');
  console.error('dangling commits from other tools with no ref protecting them.');
  const result = purgeNotesHistory(NOTES_REF);
  if (!result.purged) {
    console.log(`Nothing to purge: ${result.reason}`);
    return;
  }
  console.log(`Purged notes history for ${NOTES_REF} (old tip ${result.oldSha.slice(0, 7)} -> new tip ${result.newSha.slice(0, 7)}).`);
  console.log('Old note blobs are now unreachable and have been pruned.');
  return;
}
```
Print the warning to stderr *before* running (D-02-consistent — no interactive confirmation prompt, but a loud non-interruptive warning, matching the existing UX-pitfall pattern already used for redaction-count messages elsewhere in this codebase).

**Design consequence to document prominently (README + `--help` text):** because the collapse operates on the ref's *entire current tree*, `--purge-notes` discards note history for **every** commit's note, not just the one that had a leaked secret. There is no finer-grained purge available in git's object model for this ref shape — the planner should not attempt to build one (e.g. per-commit history rewriting of just one note's ancestry) as it would be genuine scope creep with no git-native primitive to build on.

**Confidence:** HIGH — every step of the sequence (both the failing naive version and the working corrected version) was executed against a live, throwaway git repo in this session using this machine's actual git binary (`git version 2.50.1`), not assumed from documentation or training data. The missing-reflog edge case was also independently reproduced live.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Note merge/clear for `redact <N>` | A new note read-modify-write function | `updateNote()` (`src/git.js`, Phase 5) | Already handles retry-on-conflict correctly; `redact <N>` needs no new git plumbing |
| Redaction placeholder text | A new "scrub" string constant | The literal `'[REDACTED]'` string `src/redact.js` already uses | Visual/UX consistency between automatic and manual redaction |
| Purge scoping to "just the notes ref" | A custom object-graph walker to selectively delete only note-related blobs | The verified commit-tree/update-ref/reflog-expire/gc sequence (Focus Question 7) | Git has no primitive for ref-scoped pruning; a custom walker would be far more complex and riskier than accepting the full-repo-gc blast radius and documenting it |
| Cost-computation test fixtures | A live network call to LiteLLM's pricing JSON, or a mocking library | Pre-seeded `~/.git-turn-pricing.json`-shaped cache file under the test's overridden `HOME` (Focus Question 5) | Zero-dependency, deterministic, and the exact mechanism `cost.js` already exposes for this purpose (1-week TTL cache) |

**Key insight:** Every piece of new *code* this phase needs already has a reusable primitive somewhere in the codebase (`updateNote`, the redact placeholder, the `HOME`-override test fixture pattern). The actual hard work this phase surfaced is not implementation — it's the two empirically-discovered defects (notes sha-resolution bug; purge sequence incompleteness) that must be fixed and correctly re-verified, not just wired up.

## Common Pitfalls

### Pitfall 1: Assuming "verification" phases only need tests, not code changes
**What goes wrong:** Treating VERIFY-01/VERIFY-02 as "write a test proving X works" when X currently does not work.
**Why it happens:** The phase name says "Verification," and the milestone-level research (PITFALLS.md, ARCHITECTURE.md) never flagged this specific defect — it was only found by actually running the commands end-to-end in this research session.
**How to avoid:** Treat Focus Questions 1 and 2's fixes as mandatory phase-scope tasks, not optional cleanup discovered "along the way." The success criteria in ROADMAP.md ("render real captured prompt/model/latency data end-to-end") is currently FALSE for `show`/`cost` and must become true.
**Warning signs:** A plan that only adds `show.test.js`/`cost.test.js` without also patching `show.js`/`cost.js` will produce tests that fail immediately, correctly, and by design (per this research's live repro).

### Pitfall 2: Trusting PITFALLS.md's purge sequence verbatim
**What goes wrong:** Shipping `--purge-notes` as literally "reflog expire + gc --prune=now" (the milestone research's stated sequence) and believing it works because it matches documented git-notes semantics for *other* scenarios.
**Why it happens:** PITFALLS.md's own Sources section already flagged this exact gap: *"not independently re-verified with a live repro in this research pass — recommend the object-store test... before relying on it."* That recommended repro is what this research performed, and it failed the naive sequence.
**How to avoid:** Implement the full corrected sequence from Focus Question 7 (history-collapse BEFORE reflog-expire), and add the empirical object-store test (write secret → collapse+purge → `git cat-file -e` fails) as an automated test, not just a manual verification step.
**Warning signs:** A `--purge-notes` implementation with no `git commit-tree`/`update-ref` call anywhere — if the implementation only shells out to `reflog expire` and `gc`, it is reproducing the failed naive attempt.

### Pitfall 3: `git()` throwing on a missing reflog during purge
**What goes wrong:** Calling `git(['reflog', 'expire', ...])` (the throwing helper) instead of `gitSafe(...)` for the reflog-expire step — this crashes `--purge-notes` entirely on any repo where `refs/notes/git-turn` has no reflog (verified: exit 255, "reflog could not be found").
**Why it happens:** Every other git-turn helper call in this codebase that must succeed uses `git()`; it's easy to default to that here without realizing this particular step is allowed to fail harmlessly.
**How to avoid:** Use `gitSafe()` for the `reflog expire` call specifically (per Focus Question 7's code sample) — the history-collapse step (`update-ref` to a parentless commit) already did the reachability-severing work that matters; the reflog-expire step is a secondary cleanup that must not be fatal if absent.
**Warning signs:** A test repo with `core.logAllRefUpdates=false` (or a freshly-created ref with zero reflog entries) causing `--purge-notes` to crash instead of completing.

## Code Examples

### Verified fix for the notes-lookup sha bug (Focus Questions 1-3)
```javascript
// Source: verified live this session against real hook-shaped notes + real
// record-prompt output. Apply in show.js, cost.js, log.js (--no-cache path),
// and the new redact.js.
const { headSha } = parseSnapshotMessage(turn.sha);  // already imported in show.js/log.js
const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', headSha || turn.sha]);
```

### Verified purge sequence (Focus Question 7)
```bash
# Source: verified live this session with git 2.50.1 against a throwaway repo.
TREE=$(git rev-parse refs/notes/git-turn^{tree})
NEW=$(git commit-tree "$TREE" -m "git-turn: purge notes history")
git update-ref refs/notes/git-turn "$NEW"
git reflog expire --expire=now refs/notes/git-turn   # tolerate failure if no reflog
git gc --prune=now
```

## State of the Art

| Old Approach (assumed) | Current Approach (verified) | When Changed | Impact |
|--------------------------|-------------------------------|---------------|--------|
| Purge = reflog-expire + `gc --prune=now` on the notes ref (PITFALLS.md's stated, unverified assumption) | Purge = history-collapse (parentless `commit-tree` + `update-ref`) THEN reflog-expire + `gc --prune=now` | This research session (2026-09-21) | The originally-assumed sequence does not remove the blob at all; shipping it as documented would give users false confidence that a leaked secret is gone when it is not |
| `show`/`cost` assumed to "just work" once Phase 5 writes real data | `show`/`cost` have a pre-existing sha-resolution bug independent of Phase 5's write-path correctness | This research session | VERIFY-01/VERIFY-02 as literally worded cannot pass without a code fix, not just a test |

**Deprecated/outdated:** Nothing removed. Both fixes are corrective patches to existing, otherwise-correct logic.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `--with-prompts` to `show.js` (rather than leaving it unconditional) is the intended resolution of Phase 5's open question | Focus Question 6 | LOW — based on ROADMAP.md's literal phrasing (a locked, pre-existing project doc, not this research's own invention), but it's a documentation cross-reference, not an explicit CONTEXT.md decision; if wrong, a one-line revert (remove the `args.includes` gate) is trivial |
| A2 | `git commit-tree` with empty `GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_EMAIL` (matching `snapshotWorktree()`'s existing convention in `git.js`) works reliably across git versions/configs for the purge commit | Focus Question 7 | LOW — this exact env pattern is already used elsewhere in this codebase's `snapshotWorktree()` and was not independently re-verified with empty email strings in this session's repro (repro used repo-level `git config user.email`/`user.name` instead); if `GIT_COMMITTER_EMAIL=''` ever causes a git error on some platform, the fallback is simply to omit the override and rely on git config (already required for git-turn's other operations) |
| A3 | No other code path besides `show.js`/`cost.js`/`log.js --no-cache` shares the same sha-resolution bug | Focus Questions 1-2 | MEDIUM — `blame.js`/`bisect.js`/`heatmap.js` were not audited in this research pass for the same defect (out of this phase's requirement scope, REDACT-02/03/VERIFY-01/02 only reference log/show/cost); if any of those also read notes by raw turn.sha, they'd have the same latent bug, but it's out of scope to fix here — flagging so a future phase doesn't assume they're clean by association |

## Open Questions (RESOLVED)

1. **Should `redact <N>` be able to target a turn from a session other than the current one (like `blame.js` can)?**
   - What we know: CONTEXT.md's discretion note says to follow `show.js`/`diff.js`'s convention, which is session-scoped only.
   - What's unclear: Whether a real incident-response scenario (secret found in an OLD session, not the current one) would need cross-session targeting.
   - Recommendation: Ship session-scoped only for this phase (matches the locked convention); if cross-session redaction is needed later, it's an additive change (swap `listTurns(session.session_id)` for a cross-session lookup), not a breaking one.
   - **RESOLVED:** Session-scoped only, implemented in Plan 06-03.

2. **Should `--purge-notes` warn or refuse to run if there are other dangling objects it would also delete (e.g. an active `git stash`)?**
   - What we know: `git gc --prune=now` is unconditionally full-repo; git itself does not warn before deleting stash-protected-only-by-reflog objects if stash's own reflog somehow got expired too, but normal stashes have their own protected refs (`refs/stash`) and are unaffected by this specific purge unless the user has already done something unusual.
   - What's unclear: Whether a pre-flight check (e.g. `git fsck --unreachable` and printing a count) is worth the complexity for this phase's scope.
   - Recommendation: Ship the loud stderr warning (already in Focus Question 7's code) without a pre-flight object count — matches D-02's "no confirmation prompt" spirit while still being honest about blast radius; a fancier pre-flight check can be a follow-up if real incidents surface a need.
   - **RESOLVED:** Loud stderr warning, no pre-flight object count, implemented in Plan 06-04.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | All of this phase | ✓ | 2.50.1 (Apple Git-155) | — |
| Node.js 22+ (`node:test`, `node:sqlite`) | Test suite, cache | ✓ (assumed from existing project `engines` field and Phase 5 research verifying `node:sqlite` live) | — | — |
| Network access (LiteLLM pricing URL) | `cost.js`'s live pricing fetch | Not required for this phase's tests — see Focus Question 5's network-free fixture design | — | Pre-seeded local pricing cache file |

No missing dependencies block this phase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 22+) |
| Config file | none — bare `node --test` via `npm test` |
| Quick run command | `node --test src/commands/show.test.js src/commands/cost.test.js src/commands/redact.test.js` (once created) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VERIFY-01 | `show <N>`/`show <N> --with-prompts` render real prompt/model/latency after a real `record-prompt` call | integration | `node --test src/commands/show.test.js` | ❌ Wave 0 |
| VERIFY-01 | `log --with-prompts` (both cache and `--no-cache` paths) render real prompt data | integration | `node --test src/commands/log.test.js` | ❌ Wave 0 |
| VERIFY-02 | `cost` computes a correct nonzero dollar cost from real `usage`, using a network-free pricing fixture | integration | `node --test src/commands/cost.test.js` | ❌ Wave 0 |
| REDACT-02 | `redact <N>` clears `prompt`, leaves `model`/`usage`/`latency_ms`/`tool_summary` intact, no-ops when there's no prompt | unit/integration | `node --test src/commands/redact.test.js` | ❌ Wave 0 |
| REDACT-03 | `gc --purge-notes` actually removes an old note blob from the object store (object-store-level assertion, not just note-content assertion) | integration | `node --test src/git.test.js` (new `purgeNotesHistory` tests) or `src/commands/gc.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific new/modified test file for that task
- **Per wave merge:** `npm test` (full suite — currently 164+ tests per Phase 5 research, growing)
- **Phase gate:** Full suite green before `/gsd-verify-work`, including the REDACT-03 object-store test actually invoking `git cat-file -e` on a real blob sha and asserting failure

### Wave 0 Gaps
- [ ] `src/commands/show.test.js` — new file, first-ever test coverage for `show.js`; must include the fix from Focus Question 1 to pass
- [ ] `src/commands/log.test.js` — new file, first-ever test coverage for `log.js`; must cover BOTH the cache path (already correct) and `--no-cache` path (needs the fix) as separate test cases
- [ ] `src/commands/cost.test.js` — new file, first-ever test coverage for `cost.js`; needs the `HOME`-scoped pricing-cache-seeding helper from Focus Question 5
- [ ] `src/commands/redact.test.js` — new file for the new `redact.js` command
- [ ] `src/git.test.js` — extend with `purgeNotesHistory()` tests, including the object-store-level assertion (write secret blob → purge → `git cat-file -e` fails) and the missing-reflog edge case (Pitfall 3)
- Framework install: none — `node:test` is built-in, already the project convention

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — local CLI tool, no auth boundary |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A — single-operator local tool |
| V5 Input Validation | Yes | `redact <N>`'s `<N>` is parsed with `parseInt` + `isNaN` guard (matches `show.js`'s existing pattern exactly) |
| V6 Cryptography | No | N/A — no crypto operations in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret blob believed purged but still present in object store (the exact defect this research found in the naive purge sequence) | Information Disclosure | Ship the verified full sequence (history-collapse + reflog-expire + gc), and add an automated object-store-level test (not just a note-content-level test) so a future regression is caught |
| `--purge-notes` silently deleting unrelated dangling objects a user cared about | Information Disclosure / Data Loss (inverse: destroys evidence) | Loud, non-interactive stderr warning before running (Focus Question 7) — no confirmation prompt per D-02's established style, but the blast radius must not be silent |
| `redact <N>` targeting the wrong commit due to the sha-resolution bug (if the fix from Focus Question 1 were skipped for this new command too) | Tampering (writes to wrong object) | `redact.js` must apply the same `parseSnapshotMessage(turn.sha).headSha` resolution as the fixed `show.js`/`cost.js` — do not copy the old, buggy pattern into the new command |

## Sources

### Primary (HIGH confidence — live execution or direct source reading this session)
- Live execution against this machine's git 2.50.1 in throwaway repos (multiple runs) — verified the naive purge sequence fails, the corrected sequence succeeds, the missing-reflog edge case, and the notes-ref linear-parent-chain structure via `git log --format='%H %P'`
- Live execution of this repo's actual `record-prompt.js`, `show.js`, `log.js`, `cost.js` `run()` functions against realistic hook-shaped fixtures — verified the sha-resolution bug and its fix
- `src/commands/{show,log,cost,record-prompt,gc}.js`, `src/git.js`, `src/session.js`, `src/blame-util.js`, `src/redact.js`, `src/hooks/post-commit.js`, `src/helpers/test-repo.js`, `src/helpers/turn-fixtures.js`, `src/commands/record-prompt.test.js`, `src/git.test.js`, `bin/git-turn`, `AGENTS.md`, `package.json` — all read directly this session
- `.planning/ROADMAP.md` §Phase 6 — read directly, resolved Focus Question 6

### Secondary (MEDIUM confidence — carried forward from milestone/phase research, not independently re-verified this session)
- `.planning/research/PITFALLS.md` — git-notes mechanics background, and its own explicit admission that the purge sequence was "not independently re-verified with a live repro" — this research performed that repro and found the assumption wrong
- `.planning/phases/05-record-prompt-note-write-path/05-RESEARCH.md` — `updateNote()`/cache mechanics (already HIGH-confidence there, re-confirmed by direct source reading here)

### Tertiary (LOW confidence)
- None used — every load-bearing claim in this document traces to live execution or direct source reading in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, zero ambiguity
- Architecture (bug findings): HIGH — reproduced live, root-caused via direct source diff, fix verified live
- Purge mechanics: HIGH — reproduced live (both failing and succeeding sequences), including an edge case (missing reflog)
- `show.js --with-prompts` resolution: MEDIUM — resolved via cross-referencing a locked project document (ROADMAP.md), not an explicit new CONTEXT.md decision

**Research date:** 2026-09-21
**Valid until:** 30 days (stable — findings are about this repo's own code and this machine's git behavior, not an external dependency that drifts; git's notes-commit-chain and reflog semantics are long-stable, documented core behavior unlikely to change)

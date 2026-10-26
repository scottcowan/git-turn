---
phase: 08-mcp-server-scaffold
reviewed: 2026-10-26T12:35:54Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - AGENTS.md
  - bin/git-turn
  - package.json
  - src/commands/cost.js
  - src/commands/cost.test.js
  - src/commands/mcp.js
  - src/commands/mcp.test.js
  - src/mcp/server.js
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-10-26T12:35:54Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the MCP stdio server scaffold (`src/commands/mcp.js`, `src/mcp/server.js`, CLI wiring in `bin/git-turn`) and the `cost --all` cross-session fix (`src/commands/cost.js`), plus their tests and documentation.

On the five specific attention points called out in the task:

1. **Stdout pollution:** Confirmed clean — `mcp.js` and `server.js` contain no `console.log`/`process.stdout.write` calls of any kind; the only output calls are `console.error` (pre-serveStdio only) and `process.stderr.write` (D-01 line, post-serveStdio).
2. **`process.exit` reachability:** Confirmed clean — the only `process.exit(1)` in `mcp.js` is on line 15, strictly before `serveStdio()` is called on line 24. `server.js` contains zero `process.exit`/`process.on` calls.
3. **`process.cwd()` call count:** Confirmed — exactly one call in `mcp.js` (line 22), zero in `server.js`.
4. **COST-01 correctness:** Confirmed — the `--all` branch (`cost.js:191-195`) uses `t.head_sha || t.snapshot_sha` directly from `listAllTurns()`'s pre-resolved objects; it does **not** re-derive via `parseSnapshotMessage()`, correctly avoiding the documented RESEARCH.md Pitfall 4.
5. **package.json test-script change:** A reasonable, well-investigated minimal fix (see WR-02 below for a portability caveat), not masking an implementation defect — the summary's `--test-concurrency=1` isolation test is convincing evidence the root cause is scheduler contention, not a `mcp.js`/`server.js` bug.

No Critical/blocker-level defects were found in the reviewed diff. Several robustness and quality issues are worth addressing before this scaffold grows tool handlers in Phase 9 (see Warnings), plus a few lower-severity notes (see Info).

## Warnings

### WR-01: `cost --all`'s notes lookup falls back to `snapshot_sha` when `head_sha` is unresolved, silently mis-attributing the note lookup

**File:** `src/commands/cost.js:194` (and the pre-existing single-session equivalent at `src/commands/cost.js:254-255`)
**Issue:** `refs/notes/git-turn` notes are keyed by the turn's **head** commit sha, not the snapshot commit sha (per `AGENTS.md`'s storage model section and `blame-util.js`'s own `buildHeadShaIndex` comment, which explicitly *skips* turns with a falsy `head_sha` rather than substituting anything). `cost.js`'s `--all` branch instead does:
```js
groups.get(t.session_id).push({ turn_n: t.turn_n, head: t.head_sha || t.snapshot_sha });
```
If `parseSnapshotMessage()` ever fails to find a `head ` line in a snapshot commit's message (malformed/legacy snapshot, truncated commit body, etc.), this silently substitutes the **snapshot** sha as the notes lookup key. Since notes are never attached to the snapshot commit, `gitSafe(['notes', ..., 'show', head])` on line 194's consumer (`renderSession`, line 95) will find nothing, `meta` stays `{}`, and the turn is rendered as `(no model recorded)` — indistinguishable from a turn that genuinely has no captured prompt/model data. This is a real-data-loss-of-visibility bug: the operator has no signal that the turn's cost data lookup failed for a structural reason rather than "the hook never ran."
This exact fallback pattern already existed pre-phase-8 in the single-session path (`cost.js:254-255`, unchanged by this diff) but Phase 8's refactor duplicates it into a second call site (`renderSession`'s shared body now serves both paths), doubling the exposure surface without adding the warning that `blame.js` already surfaces for the analogous `head_sha` collision case.
**Fix:** Mirror `buildHeadShaIndex`'s approach — when `head_sha` is falsy, skip the notes lookup entirely and render a distinct state (e.g. `(head sha unresolved)`) rather than silently querying notes under the wrong object:
```js
for (const { turn_n, head } of entries) {
  if (!head) {
    lines.push(`  ${String(turn_n).padStart(5)}  (head sha unresolved — skipping cost lookup)`);
    continue;
  }
  const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
  // ...
}
```

### WR-02: `package.json`'s test script relies on bash-specific `$()` command substitution and silently falls back to full autodiscovery if `find` returns nothing

**File:** `package.json:9`
**Issue:**
```json
"test": "node --test $(find src -name '*.test.js' ! -name 'mcp.test.js') && node --test src/commands/mcp.test.js"
```
This is valid under `sh`/`bash` (what `npm run` invokes on macOS/Linux) but is not portable to non-POSIX shells (e.g. `cmd.exe` on Windows, where `npm test` would fail outright since `$(...)` has no meaning). Separately, if the `find` ever matches zero files (e.g. all `*.test.js` files were renamed/removed except `mcp.test.js` in a future refactor), `node --test` is invoked with **no file arguments**, which triggers `node --test`'s own auto-discovery of **every** `*.test.js` file in the tree — including `mcp.test.js` — re-introducing the exact file-level-parallelism contention this change was written to avoid, silently, with no error surfaced.
**Fix:** Use a small inline Node/JS glob script (or simply list a maintained exclusion directly) instead of shell-level `find`, and assert at least one file matched before invoking `node --test`:
```json
"test": "node scripts/run-tests.js"
```
with `scripts/run-tests.js` doing the glob + splitting + spawning both `node --test` invocations in a shell-agnostic way, failing loudly if either file list is empty.

### WR-03: `mcp.js` has no error handling around `serveStdio(createServer)` itself

**File:** `src/commands/mcp.js:24`
**Issue:** `readSession()`'s failure path is handled explicitly (lines 12-17), but `serveStdio(createServer)` on line 24 is called with no `try/catch`. If it throws synchronously — e.g. a future `createServer()` edit that does I/O, or a transport-construction failure (stdin/stdout already in an unusual state, `StdioServerTransport` constructor throwing) — the exception propagates all the way up through `bin/git-turn`'s `require(cmdPath).run(args)` call (`bin/git-turn:38`), which has no surrounding `try/catch` for the synchronous case (it only handles a returned *promise* rejection). The result is Node's default uncaught-exception handling: a raw stack trace dumped to stderr and exit code 1 — functionally fails loudly (not silently), but inconsistent with every other command's clean `git turn: <message>` error convention, and inconsistent with D-03's own precedent one function away.
**Fix:**
```js
let handle;
try {
  handle = serveStdio(createServer);
} catch (e) {
  console.error(`git turn mcp: failed to start server: ${e.message}`);
  process.exit(1);
  return;
}
```

### WR-04: SIGINT shutdown has no bounded fallback if `handle.close()` never settles

**File:** `src/commands/mcp.js:28-32`
**Issue:**
```js
process.once('SIGINT', () => {
  handle.close().catch(() => {}).finally(() => {
    process.stdin.destroy();
  });
});
```
This is registered with `process.once`, so if `handle.close()`'s promise never resolves or rejects (e.g. the SDK is awaiting an in-flight write that itself hangs), the process has no way to progress — `finally` never runs, `stdin` is never destroyed, and a *second* SIGINT now falls through to Node's default signal handling (since the one-time listener already fired and was removed), which terminates the process but with `signal: 'SIGINT'` rather than the clean `code: 0, signal: null` that D-02 specifies. This degrades gracefully rather than hanging forever, but only by accident of `process.once`'s semantics, not by explicit design — there's no comment or test documenting this as the intended safety net, and no bounded timeout forcing a clean exit on the first Ctrl-C if `close()` is slow but would eventually finish.
**Fix:** Add an explicit timeout so a single SIGINT reliably produces the documented clean shutdown even if `close()` is slow:
```js
process.once('SIGINT', () => {
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  handle.close().catch(() => {}).finally(() => {
    clearTimeout(timer);
    process.stdin.destroy();
  });
});
```

## Info

### IN-01: `zod` is a declared runtime dependency with zero usages in the current diff

**File:** `package.json:26`
**Issue:** `zod@4.6.5` is added as a direct dependency, but no file in this phase's diff (or anywhere in `src/`) calls `require('zod')`. This is intentional and documented (RESEARCH.md explains it's a required peer of `@modelcontextprotocol/server` and will be used starting Phase 9's tool schemas), but it's worth flagging explicitly in case a future dependency-pruning pass (e.g. `depcheck`) flags it as unused without that context.
**Fix:** None needed now; consider a one-line comment in `package.json` is not possible (JSON has no comments) — a note in `AGENTS.md`'s dependency section would preserve the "why" for future maintainers already covered in RESEARCH.md but not in the shipped docs.

### IN-02: `mcp.test.js`'s static source-assertion tests use brittle line-based comment stripping

**File:** `src/commands/mcp.test.js:259-284`
**Issue:** The `no process.exit reachable after serveStdio` and `cwd captured exactly once` tests strip comments with `src.split('\n').filter(l => !l.trim().startsWith('//'))` — this only removes lines that are *entirely* a `//` comment. A future edit that adds `process.exit(1); // dead code, keep for symmetry` as a trailing comment on an otherwise-live line after `serveStdio()`, or a `/* ... */` block comment containing `process.cwd()`, would not be stripped and could produce a false pass or false fail depending on phrasing. These are good regression guards for the current file shape but are not robust to future refactors that use different comment styles.
**Fix:** Low priority given the file's current simplicity; if this pattern is reused in Phase 9 (where `mcp/server.js` grows substantially), consider a proper tokenizer/AST-based check (e.g. a quick regex that also strips `/* */` blocks and trailing `//` comments) rather than extending the current line-prefix heuristic.

### IN-03: `cost --all --json`'s top-level `session_id` field reports only the *current* session despite the response aggregating every session

**File:** `src/commands/cost.js:220-221`
**Issue:** In the `--all` + `--json` branch, the top-level `session_id` field is set to `session.session_id` (the session of the invoking repo's `session.json`, i.e. "whatever session happens to be current"), even though `turns` contains entries from every session and each turn already carries its own `session_id`. A consumer skimming only the top-level field (reasonable, since every other `cost --json` shape treats `session_id` as "the session this report is about") could be misled into thinking the report is scoped to one session. The per-turn `session_id` makes the real data recoverable, but the top-level field's meaning silently changes between the `--all` and non-`--all` shapes without any discriminating marker (no `all: true` flag, etc.).
**Fix:** Either drop the top-level `session_id` field when `--all` is set (since it's not meaningful in that mode) or set it to `null` to signal "not scoped to one session," documenting the distinction in `AGENTS.md`'s `--json` shape description.

---

_Reviewed: 2026-10-26T12:35:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

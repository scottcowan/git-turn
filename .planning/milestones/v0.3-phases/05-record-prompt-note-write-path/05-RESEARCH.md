# Phase 5: record-prompt Note-Write Path - Research

**Researched:** 2026-09-18
**Domain:** git-notes read-merge-write, Node.js sync stdin CLI parsing, node:sqlite schema migration
**Confidence:** HIGH (all claims verified directly against this repo's source or by running code against this machine's Node 22 `node:sqlite`; no external library research was needed — zero new dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Input shape
- **D-01:** `record-prompt` reads a single JSON blob from stdin (e.g. `echo '{...}' | git turn record-prompt`), not CLI flags. Rationale: this command will primarily be invoked from a hook (e.g. a future Claude Code Stop-hook wrapper), and a hook already has a structured JSON payload — reading it directly avoids the hook script having to serialize its own data into flags. Expected JSON shape: `{ prompt, model, usage, latency_ms, tool_summary }` — all fields optional (partial payloads are valid, per D-03's merge semantics).

### Target turn resolution
- **D-02:** Always targets the latest turn in the current session — no `--turn N` override. Resolved via `listTurns(sessionId)` + `parseSnapshotMessage()` (per Phase 4/milestone architecture research), never bare `HEAD`. Simplest call pattern: invoked right after a commit, targeting that commit's turn.

### Re-call / merge semantics
- **D-03:** Calling `record-prompt` more than once for the same turn merges — a later call adds/overwrites only the fields it provides, leaving previously-written fields (from the hook or an earlier `record-prompt` call) intact. This is the same read-merge-write contract already required to protect the hook's own fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`), extended to also apply between multiple `record-prompt` calls — not a new mechanism, the natural consequence of "always read-merge-write, never blind-overwrite." Supports incremental capture (e.g. prompt now, usage/latency later once available).

### Tool-call summary format
- **D-04:** Per-tool breakdown, not a total-count-only number. Shape: an object mapping tool name to call count, e.g. `{"Read": 5, "Edit": 2, "Bash": 1}`. Total count is trivially derivable by summing values; the breakdown is more useful for understanding what an agent actually did during a turn.

### Claude's Discretion
- Exact retry-on-conflict strategy for the read-merge-write race against the post-commit hook (research already recommends this; planner should follow the architecture research's `updateNote(ref, sha, patchFn)` helper pattern) — implementation detail, not user-facing. **This research's answer: bounded read-compare-retry, see Focus Question 1.**
- Whether the JSON stdin parse failure mode (malformed JSON) exits with an error or a specific message — planner's call, should just fail loudly (never silently drop data). **This research's answer: `git turn: invalid JSON on stdin: <error>` to stderr + exit 1, see Focus Question 3.**
- SQLite cache schema migration mechanics (`usage` column, `tool_summary` column, guarded `ALTER TABLE`) — implementation detail per architecture research. **This research's answer: try/catch guarded `ALTER TABLE ADD COLUMN`, see Focus Question 2.**

### Deferred Ideas (OUT OF SCOPE)
- A Claude Code Stop-hook wrapper script that actually constructs the JSON payload and pipes it to `record-prompt` — explicitly out of scope for this phase (this phase builds the receiving end only). Already tracked as a "Future Requirement" in `.planning/REQUIREMENTS.md` ("Claude Code Stop-hook wrapper to auto-supply latency_ms/prompt content to record-prompt — natural v0.3.x follow-on").
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAPTURE-01 | `git turn record-prompt` attaches prompt/model/usage/latency metadata to the current turn's note without clobbering the post-commit hook's existing fields — read-merge-write with retry-on-conflict, target resolved via the turn index, never bare `HEAD` | Focus Questions 1, 2, 6 — concrete `updateNote()` implementation, turn resolution code, cache `updatePromptFields()` |
| CAPTURE-02 | `usage` is written in the exact Anthropic-shape schema so `git turn cost` computes real costs | Focus Question 4 — validated against `cost.js`'s actual parsing code; pass-through, type-check only, no shape enforcement |
| CAPTURE-03 | `latency_ms` is captured when the caller supplies start/stop timestamps | Focus Question 6 — pass-through field, no timestamp-diffing logic inside `record-prompt.js` (caller's responsibility, out of scope this phase) |
| CAPTURE-04 | A tool-call count/name summary can be attached alongside prompt metadata | Focus Questions 5, 6 — no redaction needed on `tool_summary` (closed vocabulary), stored via the same merge/cache pattern as other fields |
</phase_requirements>

## Summary

This phase adds exactly one new writer (`src/commands/record-prompt.js`) and two small extensions to existing modules (`src/git.js` gets a new `updateNote()` helper; `src/cache.js` gets a migration + `updatePromptFields()`). No new npm packages, no new architecture. The milestone-level `ARCHITECTURE.md`/`PITFALLS.md` already settled the *shape* of the solution (read-merge-write, never `git notes append`, never bare `HEAD`); this research fills in the concrete mechanics the planner needs: what `updateNote()`'s retry loop actually checks, the exact SQL/JS for a safe `ALTER TABLE`, the sync stdin-read idiom this codebase already implicitly wants (all commands are sync except `cost.js`, which is the outlier), and how `redact()`/`cost.js`'s existing parsing behavior constrain what `record-prompt` must (and must not) validate.

**Primary recommendation:** Build `updateNote(ref, sha, patchFn)` in `src/git.js` as a *bounded retry* read-merge-write loop (not a lock, not a no-op) — the race is real in theory (hook process vs. a separately-invoked `record-prompt` process) but vanishingly rare in practice for a single-developer CLI tool with no cross-process lock primitive available cheaply. Retry-on-conflict here means "detect that the note changed between read and write, and re-run the merge" — not detecting a git-level error (there isn't one, `-f` never fails), but detecting a content-level clobber by re-reading before the final write. Everything else (stdin JSON, migration, redact placement, command file shape) follows directly from patterns already established elsewhere in this codebase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| stdin JSON parsing | CLI command (`record-prompt.js`) | — | Single-process, single-shot; no server tier exists in this project |
| Target turn resolution | CLI command, via `session.js`/`blame-util.js` | — | Same resolution helpers `show.js`/`log.js` already centralize |
| Redaction | `src/redact.js` (existing) | CLI command (call site) | Scanner is already built (Phase 4); this phase is just a new *caller* |
| Note read-merge-write | `src/git.js` (new `updateNote()`) | CLI command | Belongs next to `addNote`/`getNote` — git plumbing, not command logic |
| Cache update | `src/cache.js` (new `updatePromptFields()`) | CLI command (best-effort call) | Cache is a derived index; mutation logic belongs with the schema it touches |
| Usage schema validation | CLI command (light) | `cost.js` (defensive read, unchanged) | See Focus Question 4 below — validate-light, never reject |

## Standard Stack

No new libraries. This phase is entirely internal — `node:sqlite` (already in use, Node 22+ built-in), `node:child_process` (`execFileSync`, already in use), `node:fs`/`node:process` (stdin read). Zero-npm-dependency discipline (per AGENTS.md/PROJECT.md) is maintained with no exceptions needed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:sqlite` (`DatabaseSync`) | built-in, Node 22+ | Cache migration + `updatePromptFields()` | Already the project's only DB layer (`src/cache.js`) |
| `redact()` from `src/redact.js` | already shipped (Phase 4) | Redacts `prompt` (and any other free-text field) before write | Only sanctioned secret-scanner in this codebase |

### Package Legitimacy Audit

Not applicable — this phase installs no external packages. `package.json` is unchanged (verified: current `package.json` has no `dependencies` key at all, only `bin`/`scripts`/`engines`). No slopcheck run needed.

## Architecture Patterns

### System Architecture Diagram

```
stdin (JSON blob: {prompt, model, usage, latency_ms, tool_summary})
    │
    ▼
record-prompt.js: readStdinJSON()  ──fails──▶ stderr "git turn: <msg>" + exit 1
    │ (parsed payload, all fields optional)
    ▼
readSession() ──null──▶ stderr "git turn: not initialized..." + exit 1
    │
    ▼
listTurns(session.session_id) → latest turn (max turn_n)
    │
    ▼
parseSnapshotMessage(latestTurn.sha) → { headSha }   [never bare HEAD]
    │
    ▼
redact(payload.prompt) if present and is a string   [defend WR-01: never call
    │                                                 redact() on non-string]
    ▼
updateNote(NOTES_REF, headSha, patchFn)   [src/git.js, NEW]
    │   patchFn(existing) = merge only-provided fields into existing JSON
    │   internally: getNote → JSON.parse → patchFn → re-getNote → compare →
    │   addNote(-f) → (on detected clobber) retry, bounded
    ▼
refs/notes/git-turn  (source of truth, unchanged ref/commit target)
    │
    ▼
updatePromptFields(sessionId, turnN, {...})  [src/cache.js, NEW, best-effort
    │                                          try/catch, never throws to caller]
    ▼
stdout: plain-text confirmation (no JSON — AGENTS.md convention)
```

### Recommended Project Structure

No new directories. One new file:

```
src/
├── commands/
│   └── record-prompt.js     # NEW
├── git.js                    # MODIFIED — add updateNote()
├── cache.js                   # MODIFIED — migration + updatePromptFields()
bin/git-turn                  # MODIFIED — register 'record-prompt'
```

---

## Focus Question 1: `updateNote(ref, sha, patchFn)` — concrete mechanics and the real-vs-imagined race

**Is there a real race?** Yes, but narrow and low-severity, exactly as `PITFALLS.md` Pitfall 1 describes: the post-commit hook runs synchronously inside `git commit` (in-process serialization via `pending` promise chain, per `src/hooks/post-commit.js`), while `record-prompt` is a **separate process invocation**, typically run well after the commit completes. The only overlap window is: hook process is still mid-write (between its own `getNote`-less blind `addNote()` and process exit) at the exact moment `record-prompt` reads. Given the hook's note write is a single `git notes add -f` shell-out with no read step of its own, the window is one process's single `execFileSync` call — sub-millisecond in practice. This is **not over-engineering to guard against**, because the cost of guarding is trivial (one extra `getNote` call) and the cost of *not* guarding (silently losing `session_id`/`turn_n`/`snapshot_sha` — the whole forensic linkage) is severe and hard to detect after the fact. Recommendation: implement the guard, but as a cheap read-compare-retry, not a lock file or any cross-process IPC — a lock file would be genuine over-engineering for a tool with no concurrent multi-agent usage model today.

**What "retry-on-conflict" concretely detects:** `git notes add -f` never fails or reports a conflict at the git level (per `git-notes(1)`, confirmed in `PITFALLS.md` Pitfall 2 — `-f` always succeeds). So there is no git-level signal to retry on. The only way to detect a clobber is to re-read the note *immediately before* the final write and compare it against the note that was read at the *start* of the merge — if they differ, someone else wrote in between, and the merge must be redone against the newer value.

**Concrete implementation** (add to `src/git.js`, next to `addNote`/`getNote`):

```javascript
// Read-merge-write helper for git notes. patchFn(existingObj) -> patchedObj
// must be pure and side-effect-free (it may run more than once if a
// concurrent writer is detected). Bounded retries guard against the narrow
// window where another process (e.g. the post-commit hook) writes the same
// note between this function's read and write — see 05-RESEARCH.md Focus Q1.
function updateNote(ref, commitSha, patchFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const before = getNote(ref, commitSha);
    let existing = {};
    if (before) {
      try { existing = JSON.parse(before); } catch { existing = {}; }
    }

    const patched = patchFn(existing);
    const patchedJSON = JSON.stringify(patched);

    // Re-read right before writing. If the note changed since `before` was
    // read, another writer raced us — retry the merge against the fresh value
    // instead of blindly overwriting it.
    const justBeforeWrite = getNote(ref, commitSha);
    if (justBeforeWrite !== before) {
      if (attempt === maxRetries) {
        throw new Error(`updateNote: note for ${commitSha} changed concurrently, giving up after ${maxRetries} retries`);
      }
      continue; // retry the whole read-merge cycle
    }

    addNote(ref, commitSha, patchedJSON);
    return patched;
  }
}
```

**Trade-offs:** This still has a microscopic TOCTOU gap between the `justBeforeWrite` re-read and the `addNote` call itself — closing that fully would require a real lock (e.g. `git update-ref` style atomic CAS, which `git notes` does not expose). `PITFALLS.md` already accepts this residual gap explicitly ("losing the race just means invoke it again"). Do not attempt to eliminate it with a lockfile; that is genuine scope creep for this phase given the single-operator usage model.

**Confidence:** HIGH for the mechanism (`git notes add -f` never conflicts, confirmed by direct doc reading in `PITFALLS.md` sources) and MEDIUM for the specific retry-count/detection-window design (reasoned from the codebase, not independently load-tested — flag for a concurrency repro test per `PITFALLS.md`'s own "Warning signs" list).

---

## Focus Question 2: `src/cache.js` migration — exact SQL/JS, verified against this machine's `node:sqlite`

Verified directly by running against this repo's Node 22 `node:sqlite` (`DatabaseSync`) in this research session:

```javascript
db.exec('ALTER TABLE t ADD COLUMN b TEXT');   // succeeds, adds column
db.exec('ALTER TABLE t ADD COLUMN b TEXT');   // throws: "duplicate column name: b"
db.prepare('PRAGMA table_info(t)').all();     // works — returns column metadata rows
```

Both a **guarded try/catch ALTER** and a **PRAGMA table_info introspection** work with this project's exact `DatabaseSync` API. Recommend the try/catch form — it's one line per column, doesn't need to parse `PRAGMA` output, and matches the existing catch-and-ignore idiom already used throughout this codebase (e.g. `hooks/post-commit.js`'s `try { insertTurn(...) } catch {}`).

**Concrete migration** (add inside `openDb()` in `src/cache.js`, immediately after the existing `CREATE TABLE IF NOT EXISTS` block, so it runs on every open — cheap no-op after the first successful run):

```javascript
function migrateSchema(db) {
  const migrations = [
    'ALTER TABLE turns ADD COLUMN usage TEXT',
    'ALTER TABLE turns ADD COLUMN tool_summary TEXT',
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e; // real errors must surface
    }
  }
}
```

Call `migrateSchema(db)` right after the `CREATE TABLE IF NOT EXISTS ... turns` block inside `openDb()`, before `CREATE INDEX`. This is safe to run against:
- A brand-new `cache.db` (columns don't exist yet from the base `CREATE TABLE`, migration adds them once, no-op on every subsequent open)
- An existing pre-v0.3 `cache.db` (columns don't exist, migration adds them, existing rows get `NULL` for `usage`/`tool_summary` — SQLite's default `ALTER TABLE ADD COLUMN` behavior for existing rows, no explicit `DEFAULT` needed since all readers (`log.js`/`show.js`/`cost.js`) already read these fields defensively per `meta.usage || null`)

**`upsertTurn()` extension** — add `usage`/`tool_summary` to the existing column list, serialized as JSON text (consistent with how the note itself stores `usage` as a nested object — `JSON.stringify(meta?.usage)` if present, else `null`):

```javascript
const usage = meta?.usage ? JSON.stringify(meta.usage) : null;
const tool_summary = meta?.tool_summary ? JSON.stringify(meta.tool_summary) : null;
// ... add usage, tool_summary to both the INSERT column list and the
// ON CONFLICT DO UPDATE SET clause, exactly like the existing prompt/model/latency_ms pattern
```

**New `updatePromptFields()`** — a narrow UPDATE, no numstat recompute, per `ARCHITECTURE.md` Pattern 3:

```javascript
function updatePromptFields(sessionId, turnN, { prompt, model, latencyMs, usage, toolSummary } = {}) {
  const db = openDb();
  db.prepare(`
    UPDATE turns SET
      prompt        = COALESCE(?, prompt),
      model         = COALESCE(?, model),
      latency_ms    = COALESCE(?, latency_ms),
      usage         = COALESCE(?, usage),
      tool_summary  = COALESCE(?, tool_summary)
    WHERE session_id = ? AND turn_n = ?
  `).run(
    prompt ?? null, model ?? null, latencyMs ?? null,
    usage ? JSON.stringify(usage) : null,
    toolSummary ? JSON.stringify(toolSummary) : null,
    sessionId, turnN
  );
}
```

Note: `COALESCE(?, column)` is what implements D-03's merge semantics at the SQL layer (only overwrite a column if the new value is non-null) — this mirrors the note-level merge in `updateNote()`'s `patchFn`, so both storage layers honor "never destroy previously-written fields" consistently.

**Confidence:** HIGH — verified by direct execution against this exact Node/`node:sqlite` combination in this research session, not assumed from training data.

---

## Focus Question 3: stdin JSON parsing — sync I/O style, error convention

This codebase has **no existing stdin-reading code** to copy from directly (grepped, zero matches for `process.stdin` anywhere in `src/`). However, the sync-I/O style is unambiguous: every command in `src/commands/` is a plain synchronous `function run(args) {...}`, dispatched from `bin/git-turn` via a plain `require(cmdPath).run(args)` call — the **only** async command is `cost.js` (`async function run`, awaited via the `.then`/`.catch` check in `bin/git-turn`'s dispatcher, which already handles a Promise return). `record-prompt.js` should be **synchronous** like the majority (`status.js`, `gc.js`, `show.js`, etc.) — there is no need to `await` anything (no network calls, unlike `cost.js`'s pricing fetch).

**Reading all of stdin synchronously in Node** (no dependencies, standard idiom):

```javascript
function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8'); // fd 0 = stdin; works when piped, blocks/throws on an interactive TTY with no input
  } catch (e) {
    return null;
  }
}
```

`fs.readFileSync(0, 'utf8')` is the standard zero-dependency Node idiom for slurping piped stdin synchronously (works because `echo '{...}' | git turn record-prompt` gives fd 0 a real pipe, not a TTY). This matches the project's `execFileSync`-based synchronous style used everywhere else in `src/git.js`.

**Error convention** (verified from `git()`'s own error propagation style and every command's `console.error` calls — see grep results above): every failure path in this codebase writes `git turn: <message>` to stderr via `console.error`, then `process.exit(1)`. Apply the same convention to malformed JSON and to empty stdin:

```javascript
function run(args) {
  const raw = readStdinSync();
  if (!raw || !raw.trim()) {
    console.error('git turn: record-prompt requires a JSON payload on stdin');
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error(`git turn: invalid JSON on stdin: ${e.message}`);
    process.exit(1);
  }
  // ... continue
}
```

This satisfies CONTEXT.md's discretion note ("should just fail loudly, never silently drop data") and matches every existing failure-path convention in the codebase exactly (`git turn: <msg>` to stderr + exit 1 — no exceptions found across 10+ grep hits).

**Confidence:** HIGH for the error-message convention (directly grepped, unanimous pattern across every command file) and HIGH for `fs.readFileSync(0, ...)` as the correct zero-dependency sync stdin idiom (standard, well-documented Node behavior, not version-sensitive).

---

## Focus Question 4: `usage` validation — validate-light, never reject

Read `cost.js`'s actual parsing code directly (`computeCost()`, lines 68-75, and the `run()` loop around line 119-130): `usage` is read as `meta.usage || null` with **zero shape validation** — if `usage` is missing or any of its four fields (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`) is missing, `computeCost()` treats missing fields as `0` via `(usage.field || 0)`. If `usage` itself is `null`, `computeCost()` returns `null` early and `cost.js`'s display falls back to `?` — this is the existing "silently shows `?`/`$0.00`" behavior CAPTURE-02 exists to fix, by ensuring `record-prompt` writes usage that *matches the shape `cost.js` already expects*, not by adding new validation to `cost.js` itself.

**Recommendation: `record-prompt` should NOT reject a malformed `usage` object.** Rejecting would contradict this codebase's whole defensive-read philosophy (every reader already degrades gracefully on missing/wrong-shaped fields — see `AGENTS.md`: "read defensively where present"). Instead:

- If `payload.usage` is present and is a plain object, write it through as-is (merged into the note) — do not validate field names or types.
- If `payload.usage` is present but is **not** an object (e.g. a string or number — a caller mistake), this is the one case worth a loud failure, since writing it through would silently corrupt the note's JSON shape for every downstream reader (`cost.js` does `usage.input_tokens` — a crash-free `undefined` on a string, but still clearly wrong data). Recommend: `console.error('git turn: usage must be a JSON object'); process.exit(1)`.
- Do not enforce the four specific Anthropic field names at write time — a caller might legitimately supply a subset (e.g. only `input_tokens`/`output_tokens`, no cache fields) and `cost.js` already handles that via `|| 0`. Enforcing the full shape would reject valid partial data that CAPTURE-03-style incremental capture explicitly wants to support (per D-03's "prompt now, usage/latency later" scenario, though usage's own multi-call partial-fill isn't explicitly decided — treat as the same permissive default).

**Confidence:** HIGH — directly verified by reading `cost.js`'s exact parsing code in this session, not inferred.

---

## Focus Question 5: applying `redact()` to payload fields — which fields, and defending WR-01

**Which fields need redaction:** Only `prompt` is genuinely freeform text that could contain a pasted secret, per the phase's own payload shape (`{ prompt, model, usage, latency_ms, tool_summary }`). Walking through the others:
- `model` — a fixed enumerable identifier (e.g. `"claude-sonnet-4-5"`), never freeform, no redaction needed.
- `usage` — a structured numeric object (`input_tokens` etc.), no free text.
- `latency_ms` — a number.
- `tool_summary` — per D-04, `{"Read": 5, "Edit": 2, "Bash": 1}` — tool *names* are Claude Code's own fixed enumerable identifier set (a closed, known vocabulary: `Read`, `Edit`, `Bash`, `Write`, `Glob`, `Grep`, etc.), not user-supplied or agent-generated free text — no redaction needed on the keys. The values are integers. **No redaction needed anywhere in `tool_summary`.**

So exactly one field, `prompt`, needs to pass through `redact()`. This matches `05-CONTEXT.md`'s own framing ("all prompt/response content is redacted") — there is no separate `response` field in this phase's locked D-01 payload shape (that's deferred to the future hook-wrapper phase), so `prompt` is the sole redaction target for now.

**Defending WR-01 (redact() throws on non-string input):** `record-prompt.js` must guard before calling `redact()`, since `payload.prompt` comes from untrusted JSON and could be any JSON type (number, object, array, null) if the caller sends malformed data:

```javascript
if (payload.prompt !== undefined) {
  if (typeof payload.prompt !== 'string') {
    console.error('git turn: prompt must be a string');
    process.exit(1);
  }
  const { text, count } = redact(payload.prompt);
  payload.prompt = text;
  if (count > 0) {
    process.stderr.write(`git turn: redacted ${count} potential secret(s) from prompt\n`);
  }
}
```

This both satisfies WR-01's defensive-type-check requirement and implements `PITFALLS.md`'s UX-pitfall recommendation ("emit a clear, low-noise indicator... when redaction fires") using the exact `{ text, count }` return shape `src/redact.js` already exports.

**Confidence:** HIGH — `redact.js`'s exact signature and WR-01's exact wording were read directly from source/review docs, not assumed.

---

## Focus Question 6: `src/commands/record-prompt.js` module shape and `bin/git-turn` registration

**Module shape**, following the conventions in `status.js`/`gc.js`/`show.js` (plain `'use strict'`, `function run(args) { ... }`, single `module.exports = { run }`, no class, no default export):

```javascript
'use strict';

const fs = require('fs');
const { getNote, updateNote } = require('../git');   // updateNote is NEW
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
const { redact } = require('../redact');

function readStdinSync() { /* per Focus Q3 */ }

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const raw = readStdinSync();
  if (!raw || !raw.trim()) {
    console.error('git turn: record-prompt requires a JSON payload on stdin');
    process.exit(1);
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) {
    console.error(`git turn: invalid JSON on stdin: ${e.message}`);
    process.exit(1);
  }

  // ... field-level validation per Focus Q4/Q5 ...

  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    console.error('git turn: no turns yet this session. Make a commit first.');
    process.exit(1);
  }
  const latest = turns[turns.length - 1]; // listTurns() already sorts by turn_n ascending
  const { headSha } = parseSnapshotMessage(latest.sha);
  if (!headSha) {
    console.error('git turn: could not resolve head commit for the latest turn');
    process.exit(1);
  }

  const patched = updateNote(NOTES_REF, headSha, existing => ({
    ...existing,
    ...(payload.prompt !== undefined && { prompt: payload.prompt }), // already redacted above
    ...(payload.model !== undefined && { model: payload.model }),
    ...(payload.latency_ms !== undefined && { latency_ms: payload.latency_ms }),
    ...(payload.usage !== undefined && { usage: payload.usage }),
    ...(payload.tool_summary !== undefined && { tool_summary: payload.tool_summary }),
  }));

  try {
    const { updatePromptFields } = require('../cache');
    updatePromptFields(session.session_id, latest.turn_n, {
      prompt: payload.prompt, model: payload.model, latencyMs: payload.latency_ms,
      usage: payload.usage, toolSummary: payload.tool_summary,
    });
  } catch {}

  console.log(`Turn ${latest.turn_n}: recorded ${Object.keys(payload).join(', ')}`);
}

module.exports = { run };
```

**`bin/git-turn` registration** (two edits, both trivial, mirroring exactly how `heatmap` was added — confirmed by its presence in the current `COMMANDS` array and help text block):

1. Add `'record-prompt'` to the `COMMANDS` array (currently: `['init', 'log', 'show', 'diff', 'blame', 'bisect', 'heatmap', 'revert', 'redo', 'branch', 'status', 'gc', 'session', 'cost', 'export']`).
2. Add a help-text line inside the template literal in the `--help` block, following the existing one-line-per-command style, e.g.:
   ```
     record-prompt           Attach prompt/model/usage/latency metadata to the latest turn (JSON on stdin)
   ```

**`latency_ms` capture (CAPTURE-03):** Per D-01, the payload already carries `latency_ms` directly (a plain number) — CAPTURE-03's "captured when the caller supplies start/stop timestamps" means the *caller* (the future hook wrapper, out of scope this phase) computes `latency_ms` from its own timestamps before invoking `record-prompt`; this phase's job is only to accept and store the field verbatim if present, which the code above already does via the same `!== undefined` merge pattern as every other field. No timestamp-diffing logic belongs inside `record-prompt.js` itself.

**Confidence:** HIGH — directly modeled on `status.js`/`gc.js`/`show.js`'s exact conventions and `bin/git-turn`'s exact current `COMMANDS` array/help text, all read directly from source this session.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret scanning | A new regex/entropy scanner for `prompt` | `src/redact.js`'s existing `redact()` | Already shipped, tested (22 fixtures), and explicitly built for this exact call site (Phase 4 summary: "ready for Phase 5's record-prompt write path to call directly") |
| Turn/head resolution | A new HEAD-based lookup | `listTurns()` + `parseSnapshotMessage()` | `blame-util.js`'s own comments document a prior shipped bug from exactly this shortcut |
| Cross-process locking for the note race | A lockfile or IPC mechanism | Bounded read-compare-retry in `updateNote()` | The race window is sub-millisecond and single-operator; a lock is disproportionate engineering cost per `ARCHITECTURE.md`/`PITFALLS.md`'s own trade-off analysis |
| Usage schema strict validation | A JSON-schema validator dependency | Pass-through + one type check (object vs. non-object) | Zero-dependency discipline; `cost.js` already degrades gracefully on missing/partial fields — stricter validation than the consumer needs is wasted code |

**Key insight:** Every piece of this phase already has an established pattern elsewhere in the codebase (redaction, turn resolution, defensive JSON parsing, cache migration via try/catch). The work is *wiring*, not new design.

## Common Pitfalls

### Pitfall 1: Blind `addNote()` overwrite destroying hook-written fields
**What goes wrong:** Calling `addNote()` directly from `record-prompt.js` with only the new fields, skipping `updateNote()`'s read-merge step.
**Why it happens:** `addNote()`'s existing signature makes a naive one-shot call the path of least resistance.
**How to avoid:** `record-prompt.js` must call `updateNote()`, never `addNote()` directly. Enforce with a unit test that asserts `session_id`/`turn_n`/`snapshot_sha`/`ts` all survive a `record-prompt` call on a hook-annotated commit.
**Warning signs:** Any `require('../git')` destructure in `record-prompt.js` that imports `addNote` directly instead of (or in addition to) `updateNote`.

### Pitfall 2: Resolving the target via bare `HEAD` instead of the turn index
**What goes wrong:** Using `headSha()` from `git.js` (current HEAD at invocation time) instead of `listTurns()` + `parseSnapshotMessage()`.
**Why it happens:** `headSha()` is shorter to call and "usually" correct if invoked immediately after the commit.
**How to avoid:** Always resolve via the turn index per CAPTURE-01's explicit requirement and Focus Q6's code above.
**Warning signs:** Any call to `headSha()` inside `record-prompt.js`.

### Pitfall 3: Redacting after `JSON.stringify` instead of before
**What goes wrong:** Calling `redact()` on the already-JSON-stringified note payload, where newlines are escaped as `\n` — `redact.js`'s own module comment explicitly warns scanning must see real newlines, not escaped sequences, for multi-line secret patterns (PEM blocks) to match correctly.
**Why it happens:** Easy to accidentally stringify the whole merged object once and scan the resulting string for convenience.
**How to avoid:** Call `redact(payload.prompt)` on the raw string field *before* it's merged into any object that later gets `JSON.stringify`'d.
**Warning signs:** A single `redact(JSON.stringify(mergedPayload))` call anywhere in the implementation.

### Pitfall 4: Cache migration running only once at module load instead of per `openDb()` call
**What goes wrong:** Placing the `ALTER TABLE` calls somewhere that only runs on first import, missing the case where an old `cache.db` file predates this code change but the process was already running (unlikely for a CLI, but also: forgetting to call migration inside the *same* `openDb()` that's memoized via `_db`).
**Why it happens:** `openDb()` already has an early-return memoization (`if (_db) return _db`) — it's easy to add migration code after that early return by mistake, where it would never run on a warm module cache within one process (low risk for a CLI, since each invocation is a fresh process, but still worth being deliberate about).
**How to avoid:** Place `migrateSchema(db)` inside `openDb()` right after the `CREATE TABLE IF NOT EXISTS` block, before the early-return check would ever skip it (i.e., only on the branch that actually creates `_db` for the first time in this process) — exactly as shown in Focus Q2's code.
**Warning signs:** A cache rebuild (`gc --rebuild`) or fresh `record-prompt` call on an old `cache.db` throwing `no such column: usage`.

## Code Examples

Verified patterns from direct source reading and live execution this session:

### stdin JSON read (no dependencies)
```javascript
// Source: standard Node fs API; verified idiom, not project-specific
function readStdinSync() {
  try { return require('fs').readFileSync(0, 'utf8'); } catch { return null; }
}
```

### Guarded ALTER TABLE (verified live against this repo's node:sqlite)
```javascript
// Source: verified by direct execution in this research session against
// DatabaseSync(':memory:') on this machine's Node 22
try {
  db.exec('ALTER TABLE turns ADD COLUMN usage TEXT');
} catch (e) {
  if (!/duplicate column name/i.test(e.message)) throw e;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Notes carry only `{session_id, turn_n, snapshot_sha, ts}` (hook-written) | Notes additionally carry `prompt`/`model`/`latency_ms`/`usage`/`tool_summary` (record-prompt-written, merged) | This phase | `log --with-prompts`, `show`, `cost` finally have real data to render instead of reading defensively into a void |

**Deprecated/outdated:** Nothing removed — purely additive. `cache.js`'s existing `upsertTurn()` column list is extended, not replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tool names in `tool_summary` are a closed, non-freeform vocabulary and never need redaction | Focus Q5 | LOW — if a future custom-tool name theoretically contained sensitive text, it would bypass redaction; mitigated by the fact tool names come from Claude Code's own fixed set, not user input |
| A2 | `record-prompt` invocation frequency/timing means the note read-write race window is sub-millisecond and acceptable without a real lock | Focus Q1 | LOW-MEDIUM — if a future automation pattern calls `record-prompt` in tight loops or concurrently across multiple processes, the bounded-retry approach could still lose data after exhausting retries; mitigated by the throw-on-exhaustion behavior (loud failure, not silent data loss) |
| A3 | Usage partial-fill across multiple `record-prompt` calls (e.g. `input_tokens` in one call, `output_tokens` in a later call) should merge at the whole-`usage`-object level, not per-sub-field | Focus Q4/Q6 | LOW — D-03 explicitly covers top-level field merge; sub-field merging inside `usage` itself was not explicitly locked in CONTEXT.md. If a caller sends partial `usage` across two calls expecting field-level merge, the second call's `usage` object will fully replace the first's (whole-object semantics, matching how the rest of the merge works) rather than deep-merging — flag for planner/user confirmation if incremental usage capture is a real expected caller pattern |

## Open Questions (RESOLVED)

1. **Does `usage` need field-level (deep) merge across multiple `record-prompt` calls, or is whole-object replacement (matching every other field) sufficient?**
   - What we know: D-03 locks whole-field merge semantics ("adds/overwrites only the fields it provides"); it does not explicitly address sub-fields of a single field like `usage`.
   - What's unclear: Whether the hook-wrapper's future usage pattern will ever send `usage` in two separate calls with different sub-fields populated.
   - Recommendation: Implement whole-object replacement for `usage` (matches the rest of the merge model, simplest to reason about); document this explicitly so a future phase doesn't assume deep-merge silently.
   - **RESOLVED:** Whole-object replacement, implemented in Plan 05-02 Task 2's `updatePromptFields()`/COALESCE merge (see 05-02-PLAN.md Task 2 action).

2. **Should `record-prompt` print which fields were newly added vs. overwritten (vs. just "recorded: prompt, model")?**
   - What we know: `AGENTS.md` mandates plain-text stdout, no `--json`.
   - What's unclear: How much detail the confirmation line should carry — CONTEXT.md doesn't specify exact output text.
   - Recommendation: Planner's discretion; keep it a single line, low-noise, consistent with `redacted N secret(s)` on stderr (Focus Q5) plus a plain confirmation on stdout.
   - **RESOLVED:** Single-line low-noise confirmation, exact wording specified in Plan 05-03 Task 2's action.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 22+) |
| Config file | none — bare `node --test` via `npm test` script |
| Quick run command | `node --test src/record-prompt.test.js` (once created) |
| Full suite command | `npm test` (runs all `*.test.js` under `src/`, currently 164+ tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAPTURE-01 | Merge preserves hook fields; retry-on-conflict resolves a simulated race | unit | `node --test src/git.test.js` (new `updateNote` tests) or a new `src/record-prompt.test.js` | ❌ Wave 0 |
| CAPTURE-02 | `usage` written verbatim in Anthropic shape; `cost.js` computes nonzero cost from it end-to-end | integration | `node --test src/record-prompt.test.js` | ❌ Wave 0 |
| CAPTURE-03 | `latency_ms` passed through and persisted in both note and cache | unit | `node --test src/record-prompt.test.js` | ❌ Wave 0 |
| CAPTURE-04 | `tool_summary` per-tool breakdown persisted and round-trips through JSON | unit | `node --test src/record-prompt.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test src/record-prompt.test.js` (and `src/git.test.js`/`src/cache.test.js` if those gain new tests)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/record-prompt.test.js` — new file, covers CAPTURE-01 through CAPTURE-04 plus the JSON-parse-failure and non-string-prompt error paths
- [ ] `src/git.js` has no existing `git.test.js` in the current file listing (grepped: not present) — if the planner wants `updateNote()` unit-tested in isolation from the CLI command, a new `src/git.test.js` (or tests colocated in `record-prompt.test.js` calling `updateNote` directly) is needed
- [ ] `src/cache.js` has no existing `cache.test.js` either (grepped: not present) — migration and `updatePromptFields()` tests need a new file or colocated coverage in `record-prompt.test.js`
- Framework install: none — `node:test` is built-in, already the project convention

*(Note: `src/git.js` and `src/cache.js` currently have zero dedicated test files in this codebase — only `blame-util.test.js`, `redact.test.js`, and the `commands/*.test.js` files exist per the `ls` above. The planner should decide whether to add narrow `git.test.js`/`cache.test.js` files for the new `updateNote`/`migrateSchema`/`updatePromptFields` functions, or fold that coverage into `record-prompt.test.js` as integration-style tests exercising them indirectly. Either is consistent with existing project conventions — this project favors testing through command-level `*.test.js` files.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — local CLI tool, no auth boundary |
| V3 Session Management | No | N/A (git-turn's "session" is a domain concept, not an auth session) |
| V4 Access Control | No | N/A — single-operator local tool |
| V5 Input Validation | Yes | Type-check `payload.usage` (object) and `payload.prompt` (string) before use; reject with loud stderr error on mismatch (Focus Q4/Q5) — never silently coerce |
| V6 Cryptography | No | N/A — no crypto operations in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage via unredacted `prompt` content written to a permanent git-notes object | Information Disclosure | Mandatory `redact()` call before any write (Focus Q5); no opt-out flag (already locked by REDACT-01, unconditional) |
| JSON injection / malformed payload crashing the process or corrupting note structure | Tampering | Defensive `JSON.parse` in try/catch with loud stderr failure (Focus Q3); type-check non-object `usage` before merge |
| Race between hook and `record-prompt` silently dropping forensic linkage fields | Tampering (data integrity) | `updateNote()`'s bounded retry-on-conflict (Focus Q1) |

## Sources

### Primary (HIGH confidence — direct source reading or live execution this session)
- `src/git.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js`, `src/redact.js`, `src/commands/{status,gc,show,log,cost}.js`, `src/hooks/post-commit.js`, `bin/git-turn`, `AGENTS.md`, `package.json` — all in `/Users/scowan/Projects/scottcowan/git-turn`, read directly this session
- Live execution against this machine's Node 22 `node:sqlite` `DatabaseSync` — verified `ALTER TABLE ADD COLUMN` guard pattern and `PRAGMA table_info` both work as expected

### Secondary (MEDIUM confidence — carried forward from milestone research, not independently re-verified this session)
- `.planning/research/ARCHITECTURE.md` — read-merge-write design, cache migration recommendation (verified consistent with direct source reading this session)
- `.planning/research/PITFALLS.md` — race-condition reasoning, `git notes add -f` never-conflicts behavior (traces to `git-scm.com/docs/git-notes`, fetched by the milestone researcher, not re-fetched this session)

### Tertiary (LOW confidence — none used this session; all findings verified against primary or secondary sources above)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all internal, directly verified
- Architecture: HIGH — extends an already-designed, already-reviewed milestone architecture with concrete, source-verified mechanics
- Pitfalls: HIGH — every pitfall traces to either this session's direct source reading or the milestone `PITFALLS.md`'s already-cited authoritative sources (`git-scm.com/docs/git-notes`)

**Research date:** 2026-09-18
**Valid until:** 30 days (stable — no external dependencies to drift; only risk is if `node:sqlite`'s experimental API changes in a Node point release before this phase ships)

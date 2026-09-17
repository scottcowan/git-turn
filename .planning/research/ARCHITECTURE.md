# Architecture Research

**Domain:** git extension CLI — prompt/response capture integration (v0.3 milestone)
**Researched:** 2026-09-17
**Confidence:** HIGH (all claims verified directly against this repo's source; one MEDIUM-confidence gap flagged on the "reuse warren's secret pattern list" assumption)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│ git commit (any agent)                                                │
├───────────────────────────────────────────────────────────────────────┤
│  post-commit hook (src/hooks/post-commit.js)                          │
│   - createCheckpoint(): snapshotWorktree() -> commit-tree              │
│   - updateRef(turnRef)                                                 │
│   - addNote(NOTES_REF, head, {session_id,turn_n,snapshot_sha,ts})      │  <- FIRST note write, no prompt fields
│   - insertTurn() into SQLite cache (meta: {} — prompt unknown here)    │
├───────────────────────────────────────────────────────────────────────┤
│  [NEW] git turn record-prompt   (invoked later, out-of-band, by agent)│
│   - resolve target turn's real head sha (turnRef -> parseSnapshotMsg) │
│   - redact(prompt), redact(response) via new src/redact.js            │
│   - getNote(NOTES_REF, head) -> merge -> addNote(-f) SAME note, SAME  │  <- SECOND write, same ref/commit, read-merge-overwrite
│     ref, SAME commit (git notes has no JSON-aware append; -f replaces │
│     the whole note text, so record-prompt MUST read-merge-write or it │
│     destroys session_id/turn_n/snapshot_sha/ts written by the hook)   │
│   - updatePromptFields() — lightweight SQLite UPDATE (no diff redo)   │
├───────────────────────────────────────────────────────────────────────┤
│  refs/notes/git-turn   <-- SOURCE OF TRUTH (both writers target this) │
│  SQLite cache.db       <-- derived, rebuildable index (never authority)│
├───────────────────────────────────────────────────────────────────────┤
│  log.js / show.js / cost.js                                           │
│   cache-first (getTurns/getAllTurns) -> fallback to notes ref-walk    │
│   (gitSafe notes show + JSON.parse) — --no-cache always hits this path│
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `src/hooks/post-commit.js` | Fires on every commit; writes snapshot + turn ref + **first** note write (session_id/turn_n/snapshot_sha/ts only) | Unchanged in this milestone — still writes `meta: {}` to cache; never sees prompt/model data (not known at commit time) |
| `src/commands/record-prompt.js` (NEW) | Attaches prompt/model/latency_ms/usage to an *existing* turn's note, after the fact | New command file; read-merge-write into the same note; redact before write; best-effort cache update |
| `src/redact.js` (NEW) | Content-level secret scanning of free-text prompt/response before it touches disk | Regex pattern list for secret-shaped substrings (API key prefixes, PEM headers, Bearer tokens, high-entropy runs) |
| `src/git.js: addNote/getNote` | Generic git-notes plumbing (`git notes --ref=X add -f`, `git notes --ref=X show`) | Unchanged — reused as-is by record-prompt exactly as post-commit.js uses it |
| `src/session.js: listTurns/turnRef` | Resolves turn_n -> snapshot sha -> (via blame-util's `parseSnapshotMessage`) real head sha | Unchanged — record-prompt reuses the exact resolution pattern `show.js`/`log.js` already use |
| `src/cache.js` | Derived SQLite index; rebuildable from refs+notes; never authoritative | Add `usage` column + migration; add lightweight `updatePromptFields()`; `upsertTurn()` gains `usage` in its column list |
| `log.js` / `show.js` / `cost.js` | Render turn data cache-first, notes-ref-walk fallback | **No changes required** for `--no-cache` correctness — see Data Flow below |

## Recommended Project Structure

```
src/
├── commands/
│   └── record-prompt.js     # NEW — the only new command file this milestone
├── redact.js                 # NEW — content secret-scanner, used only by record-prompt.js
├── hooks/
│   └── post-commit.js        # UNCHANGED (still writes empty meta to cache)
├── git.js                     # UNCHANGED — addNote/getNote reused as-is
├── session.js                  # UNCHANGED — listTurns/turnRef reused as-is
├── blame-util.js               # UNCHANGED — parseSnapshotMessage reused as-is
├── cache.js                    # MODIFIED — usage column + migration + updatePromptFields()
└── commands/
    ├── log.js                  # UNCHANGED (already reads meta.prompt/model/latency_ms defensively)
    ├── show.js                 # UNCHANGED (already reads meta.prompt/model/latency_ms defensively)
    └── cost.js                 # UNCHANGED (already reads meta.usage defensively, --no-cache always — never touches SQLite cache today)
bin/git-turn                   # MODIFIED — add 'record-prompt' to COMMANDS array + help text
```

### Structure Rationale

- **No new storage primitive.** Prompt capture is bolted onto the existing single-note-per-commit model. There is no case for a second notes ref or an "append" note — `refs/notes/git-turn` already carries turn identity; record-prompt enriches the same object.
- **`src/redact.js` is standalone**, not folded into `git.js` or `cache.js`, because it operates on plaintext application content (prompt/response strings), not git plumbing or SQL — keeping it separate makes it independently testable and reusable if a future MCP server (deferred to a later milestone) needs the same scanner.
- **`cost.js` is a load-bearing existing consumer of `usage`** — it already does `meta.usage || null` and expects `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`. `record-prompt`'s `--usage` payload must match this shape exactly, or `cost.js` silently shows `?` for everyone. Note also: `cost.js` reads notes directly (`gitSafe(['notes', ..., 'show', sha])`) and **never touches the SQLite cache at all today** — it has no `--no-cache` flag because it has no cache path in the first place. This is a pre-existing inconsistency worth flagging to the roadmap (see Anti-Patterns), not something this milestone needs to fix.

## Architectural Patterns

### Pattern 1: Read-merge-write note update (NOT append, NOT a new note)

**What:** `git notes add -f` (the only write primitive `addNote()` exposes) replaces the entire note body for a commit. Because the post-commit hook has already written `{session_id, turn_n, snapshot_sha, ts}` on the head commit by the time `record-prompt` runs, a naive `addNote()` call from `record-prompt` would silently destroy those fields.

**When to use:** Every subsequent write to a commit's note in this system, present and future (e.g. if a later milestone adds more fields).

**Trade-offs:** Small TOCTOU window between the `getNote` read and the `addNote` write in `record-prompt` — acceptable because record-prompt is a single, deliberate CLI invocation per turn (not high-frequency like the hook), and losing the race just means "invoke it again." No process-level lock is justified for this milestone.

**Example (record-prompt.js core logic):**
```javascript
const { getNote, addNote } = require('../git');
const { NOTES_REF } = require('../session');
const { redact } = require('../redact');

function attachPrompt(headSha, { prompt, model, latencyMs, usage }) {
  const existing = getNote(NOTES_REF, headSha);
  let payload = {};
  try { payload = existing ? JSON.parse(existing) : {}; } catch {}

  payload.prompt = prompt !== undefined ? redact(prompt) : payload.prompt;
  payload.model = model !== undefined ? model : payload.model;
  payload.latency_ms = latencyMs !== undefined ? latencyMs : payload.latency_ms;
  payload.usage = usage !== undefined ? usage : payload.usage;

  addNote(NOTES_REF, headSha, JSON.stringify(payload)); // still -f under the hood — full overwrite of the MERGED object
  return payload;
}
```

### Pattern 2: Resolve target turn by session state, not bare HEAD

**What:** `record-prompt` runs *after* the commit it's annotating, as a separate process invocation. By the time it runs, `git rev-parse HEAD` may no longer equal the commit the prompt belongs to (the agent could have made another commit, or `record-prompt` could be invoked with a delay). The command must resolve the target turn the same way `show.js`/`log.js`'s fallback path already does:

```
session = readSession()
turnN = args.turn ?? session.turn_n        // defaults to the latest turn in the active session
{ sha: snapshotSha } = listTurns(session.session_id).find(t => t.turn_n === turnN)
{ headSha } = parseSnapshotMessage(snapshotSha)   // from src/blame-util.js — the snapshot commit's own message body, NEVER the note
```

**When to use:** Always — never call `headSha()` from `git.js` directly inside record-prompt for target resolution. `git.js:headSha()` returns the *current* HEAD at invocation time, which is exactly the value that's already wrong once a second commit has landed.

**Trade-offs:** None — this is strictly correct and mirrors `blame-util.js`'s own comment: *"refs/notes/git-turn has never carried a `head` field... relying on notes' `head` left log.js's --no-cache path and show.js showing the wrong commit."* The same landmine applies to record-prompt if it resolves the target commit incorrectly.

### Pattern 3: Cache is a derived index — never the write path of record

**What:** `insertTurn()`/`upsertTurn()` in `src/cache.js` already recompute `git diff --numstat` against the previous snapshot on every call — appropriate for the hook (new turn, diff stats genuinely unknown), wasteful for record-prompt (diff stats are unchanged; only metadata is new).

**When to use:** Add a narrow `updatePromptFields(sessionId, turnN, { prompt, model, latencyMs, usage })` that does a plain `UPDATE turns SET prompt=?, model=?, latency_ms=?, usage=? WHERE session_id=? AND turn_n=?` — no numstat recomputation, no `turn_files` touch. Call it from `record-prompt` in the same best-effort `try {} catch {}` style the hook already uses around `insertTurn()`.

**Trade-offs:** If the cache row doesn't exist yet (e.g. cache was never built, or `--no-cache` users never triggered a rebuild), the UPDATE affects 0 rows and is silently a no-op — acceptable, because the note (source of truth) already has the data, and the next `git turn gc --rebuild` will pick it up via the existing `rebuild()` -> `upsertTurn()` path once `usage` is added to that function's column list (see Data Flow).

## Data Flow

### Write Flow (two independent writers, one shared object)

```
git commit
    ↓
post-commit.js: createCheckpoint()
    ↓
addNote(NOTES_REF, head, {session_id, turn_n, snapshot_sha, ts})   <- write #1, full payload at this point
insertTurn({ ..., meta: {} })  → cache row created, prompt/model/latency_ms/usage = NULL
    ↓
    ... time passes, agent gets a response ...
    ↓
git turn record-prompt --prompt "..." --model "..." --latency-ms N --usage '{"input_tokens":..}'
    ↓
resolve headSha for target turn (session.turn_n or --turn N, via listTurns + parseSnapshotMessage)
    ↓
redact(prompt) via src/redact.js  (MUST happen before any disk/ref write)
    ↓
getNote(NOTES_REF, headSha) → parse → merge new fields into existing payload
    ↓
addNote(NOTES_REF, headSha, mergedPayload)   <- write #2, same ref, same commit, full overwrite of MERGED object
    ↓
updatePromptFields(sessionId, turnN, {...})  → best-effort cache UPDATE, no diff recompute
```

### Read Flow (cache-first, notes fallback — unaffected by this milestone)

```
log.js / show.js:
  if (!noCache) { try cache.getTurns()/getTurnFiles() ... return if hit }
  → fallback: listTurns() [git ref-walk] + getNote()/gitSafe(notes show) [git object read] + JSON.parse
```

Because record-prompt writes into the *same note object* the hook created, both paths — cache (once `updatePromptFields`/`upsertTurn` carry `usage`) and the notes ref-walk fallback (already JSON.parses the full note, already reads `meta.prompt`/`meta.model`/`meta.latency_ms` defensively in `log.js`/`show.js`, already reads `meta.usage` in `cost.js`) — see identical data with zero changes required to the fallback branches themselves. **This is the key answer to "won't break --no-cache":** the fallback was already written defensively for these fields before record-prompt existed (per PROJECT.md: "read defensively where present but nothing shipped writes them yet") — record-prompt is the first thing that finally writes what those paths were already prepared to read.

### Key Data Flows

1. **Note enrichment:** One note per commit, two writers across time (hook writes structural fields synchronously at commit time; record-prompt writes content fields asynchronously afterward) — reconciled by read-merge-write, never by a second note or `git notes append`.
2. **Cache enrichment:** Cache mirrors whatever the note currently contains. A cache row can legitimately go through two lifecycle states — "structural only" (right after commit) then "full" (after record-prompt) — and `rebuild()` from a cold cache produces the "full" state directly in one pass since it reads the note only once, after both writers have already run.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single developer, single repo | Current design is sufficient — one note write per commit, one enrichment write per record-prompt call, negligible overhead |
| Many sessions / long history | `git notes` reads/writes are O(1) per commit regardless of history size (notes are stored as their own tree, not scanned) — no adjustment needed |
| `gc --rebuild` on large histories | Already walks all `refs/git-turn/sessions/` refs and re-reads every note once — adding `usage` to the column list adds no new git calls, just one more JSON field parsed per note already being parsed |

### Scaling Priorities

1. **First bottleneck:** None introduced by this milestone — record-prompt is a single additional git-notes round trip per turn, same cost class as the hook's own note write.
2. **Second bottleneck:** N/A at this scale.

## Anti-Patterns

### Anti-Pattern 1: Writing a second note or using `git notes append` for prompt data

**What people do:** Reach for `git notes append` (git's own append primitive) thinking it avoids the read-merge-write dance.
**Why it's wrong:** `git notes append` concatenates raw *text* blobs — it has no concept of JSON structure, so appending would produce a note body that is no longer valid JSON (`{...}{"prompt":...}`), breaking every existing reader (`log.js`, `show.js`, `cost.js`, `cache.js`'s `rebuild()`) which does `JSON.parse(note)` unconditionally in a try/catch that would now silently swallow the parse failure and fall back to `meta = {}`.
**Do this instead:** Read the note, `JSON.parse`, merge in-memory, `addNote(..., '-f', ...)` the merged object back — exactly what post-commit.js already does for the *first* write; record-prompt just needs to read first.

### Anti-Pattern 2: Resolving the note target via `headSha()` (current HEAD) instead of the turn's recorded head

**What people do:** Assume record-prompt is always invoked immediately after the relevant commit, so `git rev-parse HEAD` is "close enough."
**Why it's wrong:** Agents frequently make several commits before a turn boundary is reported back (or the CLI invocation is delayed), and `blame-util.js`'s own comments document a prior incident where exactly this class of bug ("relying on notes' `head`... left log.js's --no-cache path and show.js showing the wrong commit") shipped and had to be fixed by parsing the snapshot commit's message body instead.
**Do this instead:** Always resolve via `listTurns(sessionId)` → matching `turn_n` → `parseSnapshotMessage(snapshotSha).headSha`, the same helper `show.js`/`log.js`/`blame-util.js` already centralize this logic in.

### Anti-Pattern 3 (pre-existing, flag for roadmap awareness, not this milestone's job to fix): `cost.js` bypasses the cache entirely

**What people do (already shipped):** `cost.js` reads notes directly via `gitSafe(['notes', ...])` for every turn, with no cache-first branch and no `--no-cache` flag — inconsistent with `log.js`/`blame.js`/`bisect.js`, which are all cache-first with fallback.
**Why it's wrong:** Not wrong today (cost.js correctness is unaffected either way, since notes are always the source of truth) but it means `cost.js` gets zero benefit from the SQLite cache's speed, and its behavior can never be told to skip the cache because it never uses one — a latent inconsistency, not a bug.
**Do this instead:** Out of scope for v0.3 prompt capture. Worth a small follow-up ticket to make `cost.js` cache-first like its siblings once `usage` is a first-class cache column (this milestone adds exactly that column, which is what would unblock the follow-up).

## Integration Points

### External Services

None. This milestone is entirely local (git object store, git notes, SQLite file) — no network calls, matching the existing "no server required" key decision in PROJECT.md.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `bin/git-turn` ↔ `src/commands/record-prompt.js` | Direct `require().run(args)` dispatch, identical to every existing command | Add `'record-prompt'` to the `COMMANDS` array and the `--help` text block; no dispatcher logic changes needed |
| `record-prompt.js` ↔ `src/git.js` | `getNote`/`addNote` (existing exports, unchanged signatures) | Confirmed `addNote()` always passes `-f`; record-prompt relies on this to overwrite the merged payload |
| `record-prompt.js` ↔ `src/session.js` / `src/blame-util.js` | `readSession()`, `listTurns()`, `parseSnapshotMessage()` (existing exports, unchanged signatures) | Reuses the exact turn-resolution pattern `show.js` already implements — no new resolution logic needed, just import the existing helper |
| `record-prompt.js` ↔ `src/redact.js` (NEW) | Direct function call, `redact(text) -> string` | Must run before any I/O — redact in-memory, then write |
| `record-prompt.js` ↔ `src/cache.js` | New `updatePromptFields()` export, called best-effort inside `try {} catch {}` | Never throws into the caller — matches the hook's own `try { insertTurn(...) } catch {}` discipline exactly |
| `src/cache.js` `openDb()` ↔ existing `cache.db` files | Schema migration: `usage TEXT` column must be added via a guarded `ALTER TABLE` (checked against `PRAGMA table_info(turns)` or wrapped in try/catch), since `CREATE TABLE IF NOT EXISTS` does not retrofit columns onto an already-existing table | Without this, users with a pre-v0.3 `cache.db` get a SQL error the first time `upsertTurn()`/`updatePromptFields()` references the `usage` column |
| `record-prompt.js` ↔ `src/commands/cost.js` (indirect, shape contract) | `--usage` JSON must match `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` | Verified by reading `cost.js`'s `computeCost()` — any other shape silently produces `cost === null` for that turn with no error surfaced |

## Gap Flagged: "Reuse warren's secret pattern list" needs adjustment

**Confidence: MEDIUM** (verified by reading warren's source directly, not assumed).

Investigated `/Users/scowan/Projects/scottcowan/warren/packages/warren-common/src/warren_common/logging.py` (`redact_processor`) and `secrets.py`. Warren's only redaction mechanism is a **structured key-name matcher**: it redacts a `structlog` event-dict value if its *key* is exactly `TOKEN`/`KEY`/`SECRET`/`PASSWORD` or ends with `_TOKEN`/`_KEY`/`_SECRET`/`_PASSWORD` (case-insensitive), plus a blanket rule for any dict stored under the literal key `env`. It has **no regex list for secret-shaped *content*** (no AWS `AKIA...`, no GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, no Slack `xox[baprs]-`, no PEM headers, no high-entropy heuristic) — and it's Python, not directly importable into this Node.js codebase regardless.

PROJECT.md's stated requirement — "scan for likely secrets (API keys, high-entropy tokens) **before any prompt/response content** is written" — is a free-text content scan. Free-text prompts/responses have no key names to match against; warren's key-suffix approach is structurally inapplicable to this milestone's actual redaction target.

**Recommendation for the roadmap:** Treat "reuse warren's secret pattern list" as satisfied only for the *convention* (redact-by-suffix on structured fields, `[REDACTED]` placeholder token), and budget real work in `src/redact.js` for a genuine content-pattern scanner (common secret-shape regexes + a generic high-entropy run detector) — this is new code, not an import, despite the phrasing in PROJECT.md. Flag this explicitly during roadmap creation so Phase 1 of the milestone isn't scoped as "wire up warren's redactor" (which would be a no-op integration) but as "build a content secret-scanner, reusing warren's `[REDACTED]` placeholder and key-suffix convention where structured fields (e.g. a stray `api_key` field inside `--usage` JSON) apply."

## Suggested Build Order

1. **`src/redact.js`** (new, no dependencies) — content secret-scanner + `[REDACTED]` placeholder, unit-testable in isolation before touching notes/cache at all.
2. **`src/cache.js` schema migration** — add `usage TEXT` column (guarded `ALTER TABLE` for existing DBs), extend `upsertTurn()`'s column list to include `usage` from `meta?.usage`, add `updatePromptFields()`. Do this before the command exists so `record-prompt` has a stable target to call into, and so `gc --rebuild` on an old cache.db doesn't break the moment this ships.
3. **`src/commands/record-prompt.js`** (new) — turn resolution (reusing `listTurns`/`parseSnapshotMessage`), redact, read-merge-write note, best-effort cache update. Depends on 1 and 2.
4. **`bin/git-turn`** — add `'record-prompt'` to `COMMANDS` and help text. Trivial, last, so the command isn't reachable via CLI until it's actually finished.
5. **`log.js`/`show.js` `--with-prompts` flag polish** — both already read `meta.prompt` defensively and gate display behind an existing `--with-prompts` check in `log.js`; verify `show.js` also respects it consistently (currently `show.js` prints `meta.prompt` unconditionally whenever present, with no flag gate — decide during roadmap whether that's intentional-by-design for `show <N>` — single-turn — versus `log`'s multi-turn listing where a flag makes more sense to avoid noisy output).

## Sources

- Direct source reading (HIGH confidence, no training-data assumptions): `src/hooks/post-commit.js`, `src/git.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js`, `src/commands/log.js`, `src/commands/show.js`, `src/commands/cost.js`, `bin/git-turn`, `.planning/PROJECT.md` — all in `/Users/scowan/Projects/scottcowan/git-turn`.
- `/Users/scowan/Projects/scottcowan/warren/packages/warren-common/src/warren_common/logging.py` and `secrets.py` — read directly to verify (and correct) the "reuse warren's secret pattern list" assumption in PROJECT.md.

---
*Architecture research for: git-turn v0.3 Prompt Capture integration*
*Researched: 2026-09-17*

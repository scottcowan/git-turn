# Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output - Research

**Researched:** 2026-10-08
**Domain:** Node.js CLI refactor (pure-function extraction) + hand-rolled unified-diff rendering + CLI-wide structured output
**Confidence:** HIGH (every claim below is verified against this repo's actual source and tests, read directly this session; no external library research was needed — zero new npm dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Rich diff visual style (DIFF-01)**
- **D-01:** Gutter shows **new-file line numbers only** — one right-aligned column. No old-file column (rejected two-column side-by-side style).
- **D-02:** The "Added N / removed M" summary header goes at the **top**, before the diff body (matches `git --stat` convention and delta/diff-so-fancy).
- **D-03:** Rich rendering must respect `NO_COLOR`/`FORCE_COLOR`/TTY exactly the way today's output does via `shouldColor()`. When color is off, the rich renderer still emits the gutter and summary header, just without ANSI codes.

**`--plain` scope**
- **D-04:** `--plain` is recognized **only by `diff` and `show`** — the two commands whose rendering actually changes. `log`/`blame`/`cost` do not accept it (no rich-vs-plain distinction to toggle). AGENTS.md should document `--plain` as diff/show-specific.
- **D-05:** REFACTOR-01's "byte-identical output" acceptance criterion is verified against `diff --plain`/`show --plain` (and the unflagged default for `log`/`blame`/`cost`, which don't change). Existing `diff`/`show` tests that assert on output should pass when pointed at the `--plain` path.

**`--json` output shape (JSON-01)**
- **D-06:** **Natural shape per command**, no shared envelope. E.g. `log --json` → array of turn objects; `cost --json` → `{ turns: [...], total_cost, ... }`; `show --json` → turn metadata + diff. Each command's shape is optimized for its own data (docker/kubectl-style per-subcommand JSON), not forced into a `{command, data, meta}` wrapper.

**Error handling in `--json` mode**
- **D-07:** When a command fails with `--json` set, it prints a **JSON error object to stdout** — `{"error": "<same message text the CLI prints today>"}` — and exits 1. Scripts can always `JSON.parse(stdout)` regardless of success/failure. Without `--json`, error behavior is unchanged (plain text to stderr, exit 1).
- This falls naturally out of the compute/run split: `compute()` throws `Error`, and `run()` decides how to present it (stderr text vs. stdout JSON) based on `--json`.

**Folded Todos**
- `.planning/todos/pending/2026-09-07-rich-diff-renderer.md` ("Richer full-line-highlight diff renderer for show/diff") — folded per explicit user direction, now requirement DIFF-01. Prior-art pointers (`diff-so-fancy`, `delta`) apply. Conflict with REFACTOR-01's byte-identical bar resolved by D-04/D-05: rich is the new default, `--plain` is the byte-identical path.

### Claude's Discretion
- Exact field names and nesting inside each command's `--json` shape (D-06 sets the principle; this research proposes concrete schemas in Code Examples below — should be documented in AGENTS.md).
- Exact ANSI background colors for added/removed rows and the gutter's dim styling (proposed in Architecture Patterns, Pattern 3 — see Assumption A1).
- Whether `--json` + `--plain` together is meaningful (this research recommends: `--json` wins and `--plain` is ignored — diff content in JSON is raw unified diff text, uncolored — see Assumption A3).
- Whether the rich renderer is a new module (e.g. `src/diff-render.js`) shared by `diff.js`/`show.js`, or inline — this research recommends a shared module (see Recommended Project Structure).
- Whether to hand-parse unified diff hunks or use `git diff` plumbing flags to simplify parsing — this research recommends hand-parsing, reusing `blame-util.js`'s existing `parseHunkHeader()` (see Don't Hand-Roll).
- How `cost.js`'s `process.stderr.write('Fetching pricing data...\r')` progress indicator is handled under the split — this research recommends moving it into `run()`, bracketing the call to `compute()` (see Common Pitfalls, Pitfall 3).

### Deferred Ideas (OUT OF SCOPE)
None new from the Phase 7 discussion. (Reviewed but not folded: `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` — unrelated SHA-anchoring robustness research, stays in backlog.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| REFACTOR-01 | `log`/`show`/`diff`/`blame`/`cost` each export a `compute(args)` function returning a string (or `Promise<string>` for `cost`) and throwing `Error` on failure, with `run(args)` reduced to a thin CLI wrapper — byte-identical CLI behavior when run with `--plain` | Architecture Patterns Pattern 1 (shape + worked example), Common Pitfalls 1-4 (blame's two code paths, cost's stderr write, gitSafe stdio non-issue), Validation Architecture (test map), confirmed via direct test-harness analysis that byte-identity holds by construction |
| DIFF-01 | `diff`/`show` render a richer full-line-highlight format by default (full-row ANSI background, line-number gutter, "Added N / removed M" summary header); `--plain` restores exact current behavior byte-for-byte | Architecture Patterns Pattern 2 & 3 (concrete renderer algorithm + code), Don't Hand-Roll (reuse `parseHunkHeader`/`shouldColor`), Common Pitfall 5 (single source of truth for added/removed counts), Open Question 2 (hunk-header styling) |
| JSON-01 | CLI-wide `--json` flag on all 5 commands, structured JSON instead of formatted text | Code Examples (per-command proposed JSON shapes + error object), Pattern 1 (compute() internal branching), Assumptions A2/A3 (open shape questions) |
</phase_requirements>


## Summary

This phase touches exactly five files (`log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`) plus one new shared module. The three deliverables are not independent — they compose into one small, consistent pattern per command:

1. **`compute(args)`** becomes the single source of truth. It parses `args` (including `--json`, `--plain`, `--with-prompts`, `--no-cache`, `--all` as applicable), does all data gathering, and returns one string — either human-formatted text or a `JSON.stringify`'d object — never touching `console.*` or `process.exit`. Errors become `throw new Error(...)`.
2. **`run(args)`** becomes a 6-line wrapper: call `compute`, `console.log` the result; on catch, check `args.includes('--json')` to decide whether the error becomes a JSON object on stdout (`exit 1`) or plain text on stderr (`exit 1`, today's behavior, byte-identical).
3. **Rich diff rendering** (`diff`/`show` only) lives in a new `src/diff-render.js` module that both commands call. It never asks `git diff` for ANSI color — it always fetches a plain-text unified diff and paints it itself, which is what makes the gutter/background-highlight/summary-header rendering possible at all (git's own `--color=always` output cannot be reliably re-colored without stripping and re-parsing ANSI codes, which is unnecessary risk this phase doesn't need to take).

Verified empirically this session: the existing test suite's capture pattern (`console.log = (...a) => logs.push(a.join(' '))`, then `logs.join('\n')`) produces byte-identical reconstructed output whether the command calls `console.log` once-per-line (today) or once with a single `\n`-joined string (post-refactor) — because every `console.log` call already appends its own `\n`, and `Array.prototype.join('\n')` reconstructs exactly that. This is the mechanical justification for REFACTOR-01's "existing tests pass unmodified" acceptance bar — it is not aspirational, it is a consequence of how the capture harness and `console.log` both work.

**Primary recommendation:** Build one shared pattern (`compute()` returns a string, branches internally on `--json`/`--plain`; `run()` is a thin dispatcher that only needs to know about `--json` for error-shape selection) and apply it identically across all five commands, with `diff.js`/`show.js` additionally delegating to the new `src/diff-render.js` for the rich-rendering path.

## Architectural Responsibility Map

This is a local CLI tool, not a web app — the standard Browser/SSR/API/CDN/DB tiers don't apply directly. The closest honest analog, mapped to this codebase's actual layering:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Argument parsing (`--json`/`--plain`/`--with-prompts`/`--no-cache`/`--all`) | `compute()` (data/logic layer) | `run()` (CLI shell) | `compute()` must own all flag branching so a future MCP caller can pass an equivalent args array without touching `run()`/`process.exit`-adjacent code at all (per ARCHITECTURE.md's build-order rationale) |
| Output formatting (plain text, rich ANSI, JSON) | `compute()` | `src/diff-render.js` (for diff/show's rich path only) | Formatting-as-pure-function is exactly what makes `compute()` MCP-callable later — `run()` must do nothing but `console.log` the already-finished string |
| Error presentation (stderr text vs. stdout JSON) | `run()` | — | This is the one piece of flag-awareness `run()` legitimately needs — it decides *where* an already-thrown `Error`'s message goes, which `compute()` cannot decide for itself since it never prints anything |
| Git plumbing / data retrieval (`gitSafe`, cache, notes) | `src/git.js` / `src/cache.js` / `src/blame-util.js` | — | Unchanged this phase — `compute()` calls into these exactly as `run()` does today |
| Unified-diff hunk parsing | `src/diff-render.js` (new) | `src/blame-util.js` (`parseHunkHeader`, reused) | New rendering-specific parsing (full-row background, gutter) is a new concern; the existing hunk-header regex is generic enough to reuse as-is, not fork |

## Standard Stack

### Core

No new runtime dependencies. This phase is pure refactor + hand-rolled rendering using only Node builtins (`child_process` via the existing `src/git.js` wrapper) and ANSI escape sequences written as plain template strings.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none — Node.js builtins only) | Node \>=22 (confirmed installed: v22.22.3) | string building, `JSON.stringify`, `process.stdout.columns` | Matches this project's "zero runtime npm dependencies" posture, explicitly preserved through this phase per CONTEXT.md |

### Supporting

Not applicable — no supporting libraries needed. `ansi-styles`/`chalk`/`diff`-parsing libraries were considered and rejected (see Don't Hand-Roll below for the one exception: do NOT hand-roll ANSI color *libraries* generically, but DO hand-roll this specific, narrow renderer, because git-turn's existing project convention is zero deps and the ANSI codes needed are a fixed, small set).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled ANSI background-highlight renderer | `chalk`/`ansi-styles`/`kleur` npm packages | Would be the very first new runtime dependency since the MCP milestone's SDK (deferred to Phase 8) — rejected: the ANSI codes needed (`\x1b[48;5;22m` dark green bg, `\x1b[48;5;52m` dark red bg, `\x1b[2m` dim, `\x1b[0m` reset) are ~6 fixed escape sequences, far below the threshold where a dependency pays for itself, and this project's own precedent (`src/redact.js`, hand-vendored instead of `secretlint`) explicitly favors small hand-rolled code over a dependency for anything this narrow |
| Hand-rolled unified-diff hunk parser | `diff`/`parse-diff` npm packages | Rejected for the same zero-deps reason — `src/blame-util.js` already has a working, tested `parseHunkHeader()` regex-based parser built in v0.2 for exactly this purpose; reuse it rather than adding a dependency or writing a second parser |
| `git diff --color=always` passthrough (today's approach) as the basis for the rich renderer, stripping/re-injecting ANSI codes | Fetch a second plain-text diff and render from scratch | Rejected: stripping existing ANSI codes via regex to re-derive line-type (`+`/`-`/context) is strictly more fragile than asking git for `--color=never` output and classifying each line by its leading character, which unified diff format guarantees unambiguously |

**Installation:** None — no `npm install` needed this phase.

**Version verification:** N/A — no packages to verify.

## Package Legitimacy Audit

**Not applicable this phase.** Zero new external packages are introduced by REFACTOR-01, DIFF-01, or JSON-01 — confirmed by reading `package.json` (no `dependencies` key present at all) and by CONTEXT.md's explicit statement ("No new npm dependencies in this phase — `@modelcontextprotocol/server` + `zod` arrive in Phase 8"). The Package Legitimacy Gate protocol is skipped; nothing to run `slopcheck`/`npm view` against.

## Architecture Patterns

### System Architecture Diagram

```
                         git turn <cmd> [args...]
                                   │
                                   ▼
                        bin/git-turn (unchanged dispatch)
                                   │  require(cmdPath).run(args)
                                   ▼
                 ┌─────────────────────────────────────┐
                 │  src/commands/<cmd>.js :: run(args)   │   CLI SHELL
                 │  try { console.log(compute(args)) }   │   (thin — ~6 lines)
                 │  catch (e) {                          │
                 │    if (args.includes('--json'))        │
                 │      console.log(JSON.stringify(       │
                 │        { error: e.message })); exit 1  │
                 │    else                                │
                 │      console.error(e.message); exit 1  │  <- byte-identical
                 │  }                                     │     to today
                 └───────────────────┬────────────────────┘
                                     │  calls
                                     ▼
                 ┌─────────────────────────────────────────┐
                 │  src/commands/<cmd>.js :: compute(args)   │   DATA / FORMAT LAYER
                 │  - parse flags (--json/--plain/--no-cache)│   (pure-ish: no console,
                 │  - readSession() / listTurns() / cache     │    no process.exit)
                 │  - gitSafe(...) for raw data               │
                 │  - branch: json ? JSON.stringify(obj)       │
                 │            : plain-text or rich-rendered    │
                 │  - throw new Error(msg) on any failure       │
                 │  - return ONE string                          │
                 └───────┬─────────────────────────┬─────────────┘
                         │                         │ (diff.js / show.js only)
                         ▼                         ▼
          src/git.js, src/cache.js,      src/diff-render.js (NEW)
          src/session.js, src/blame-util.js   - parseDiff(rawText) -> {files, added, removed}
          — UNCHANGED, same call paths         - renderRich(rawText, {color}) -> string
          as today                             - reuses blame-util's parseHunkHeader()
```

### Recommended Project Structure

```
src/
├── commands/
│   ├── log.js      # MODIFIED: compute()/run() split, --json
│   ├── show.js     # MODIFIED: compute()/run() split, --json, --plain, delegates rich render
│   ├── diff.js      # MODIFIED: compute()/run() split, --json, --plain, delegates rich render
│   ├── blame.js     # MODIFIED: compute()/run() split, --json
│   ├── cost.js       # MODIFIED: compute()/run() split (stays async), --json
│   ├── log.test.js, show.test.js, diff.test.js, blame.test.js, cost.test.js
│   │                 # UNCHANGED (per REFACTOR-01's acceptance bar) + NEW tests appended
│   │                 #   for compute()'s direct return value, --json, --plain, rich-render
├── diff-render.js    # NEW: parseDiff() + renderRich(), shared by diff.js/show.js
├── diff-render.test.js  # NEW
├── blame-util.js      # UNCHANGED (parseHunkHeader reused, not forked)
├── git.js              # UNCHANGED (shouldColor() reused by diff-render.js)
└── cache.js            # UNCHANGED
```

### Pattern 1: compute() owns ALL flag branching, run() owns NOTHING but error-shape

**What:** `compute(args)` internally checks `args.includes('--json')` first (highest precedence), then `args.includes('--plain')` (diff/show only), then the existing flags (`--with-prompts`, `--no-cache`, `--all`). This means `run(args)` needs to inspect `args` exactly once — in its `catch` block, to decide whether a thrown error becomes a stdout JSON object or a stderr text line. Everything else about `--json`/`--plain` behavior lives inside `compute()`.

**When to use:** Every one of the five commands, no exceptions.

**Example (log.js shape):**
```js
// src/commands/log.js — after refactor
function compute(args) {
  const session = readSession();
  if (!session) throw new Error('git turn: not initialized. Run `git turn init` first.');

  const withPrompts = args.includes('--with-prompts');
  const noCache = args.includes('--no-cache');
  const json = args.includes('--json');

  const rows = gatherTurnRows(session, { noCache });   // extracted helper, same logic as today

  if (json) {
    return JSON.stringify(rows.map(r => ({
      turn: r.turn_n,
      sha: r.head_sha || r.snapshot_sha,
      subject: r.subject,
      files_changed: r.files_changed ?? null,
      insertions: r.insertions ?? null,
      deletions: r.deletions ?? null,
      ...(withPrompts && r.prompt ? { prompt: r.prompt } : {}),
    })));
  }

  const lines = [`Session: ${session.session_id}`, ''];
  for (const r of rows) {
    lines.push(`  turn ${String(r.turn_n).padStart(2)}  ${r.sha.slice(0,7)}  ${r.subject.padEnd(50)}  ${r.stat}`);
    if (withPrompts && r.prompt) lines.push(`         prompt: ${r.prompt.slice(0,80)}...`);
  }
  return lines.join('\n');
}

function run(args) {
  try {
    console.log(compute(args));
  } catch (e) {
    if (args.includes('--json')) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
```

### Pattern 2: diff/show never ask git for color — always render color themselves

**What:** `diff.js`/`show.js`'s `compute()`, for the rich (default) path, calls `gitSafe(['diff', '--color=never', shaA, shaB])` to get a clean plain-text unified diff, then passes that raw text to `src/diff-render.js`'s `renderRich(rawText, { color: shouldColor() })`. For the `--plain` path, it calls `gitSafe(['diff', colorArg, shaA, shaB])` exactly as today (`colorArg` from `shouldColor()`), unchanged. For `--json`, it calls the same `--color=never` fetch and passes it to `diff-render.js`'s `parseDiff(rawText)` to get `{ added, removed }` counts, embedding the raw uncolored text verbatim as the `diff` field (never embedding ANSI codes in JSON output).

**When to use:** `diff.js` and `show.js` only (the two commands whose default rendering changes per DIFF-01).

**Why this matters:** Git's `--color=always` output embeds ANSI codes inline in a way that is not designed to be re-parsed or re-colored — attempting to strip and reapply colors on top of git's own color codes is both unnecessary (git can trivially be asked for `--color=never`) and exactly the kind of fragile regex-on-ANSI-codes hazard the "Don't Hand-Roll" section below would flag if attempted.

### Pattern 3: full-row background highlight via explicit terminal-width padding

**What:** A terminal only colors the characters actually printed — "full-row" background highlighting (the Claude Code side-panel look CONTEXT.md's `D-01`/specifics describe) requires padding each line's visible content with spaces out to the terminal width *before* applying the background ANSI code and resetting after, not just wrapping the line's own text.

**Concretely, in `src/diff-render.js`:**
```js
'use strict';
const { parseHunkHeader } = require('./blame-util');

const BG_ADDED = '\x1b[48;5;22m';   // dark green background
const BG_REMOVED = '\x1b[48;5;52m'; // dark red background
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function termWidth() {
  return process.stdout.columns || 120;
}

function padRow(text, width) {
  // Pad with spaces so the background ANSI code visually fills the row;
  // truncation is NOT performed — long lines simply don't get a padded
  // tail, which matches delta/diff-so-fancy's own behavior on wide lines.
  return text.length < width ? text + ' '.repeat(width - text.length) : text;
}

function parseDiff(rawText) {
  const files = [];
  let added = 0, removed = 0;
  let oldLine = 0, newLine = 0;
  let currentFile = null;

  for (const line of (rawText || '').split('\n')) {
    if (line.startsWith('diff --git')) {
      currentFile = { header: line, hunks: [] };
      files.push(currentFile);
      continue;
    }
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      currentFile?.hunks.push({ header: line, lines: [] });
      continue;
    }
    if (!currentFile?.hunks.length) continue; // file-header noise (---/+++/index/etc.)
    const curHunk = currentFile.hunks[currentFile.hunks.length - 1];

    if (line.startsWith('+') && !line.startsWith('+++')) {
      curHunk.lines.push({ type: 'add', newLineNo: newLine, text: line.slice(1) });
      newLine++; added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      curHunk.lines.push({ type: 'del', newLineNo: null, text: line.slice(1) });
      oldLine++; removed++;
    } else if (line.startsWith(' ')) {
      curHunk.lines.push({ type: 'ctx', newLineNo: newLine, text: line.slice(1) });
      oldLine++; newLine++;
    }
    // lines like "\ No newline at end of file" are intentionally dropped from rendering
  }
  return { files, added, removed };
}

function renderRich(rawText, { color } = {}) {
  const { files, added, removed } = parseDiff(rawText);
  const gutterWidth = String(
    Math.max(1, ...files.flatMap(f => f.hunks.flatMap(h => h.lines.map(l => l.newLineNo || 0))))
  ).length;

  const out = [`Added ${added} / removed ${removed}`, ''];
  const width = termWidth();

  for (const file of files) {
    out.push(color ? `${DIM}${file.header}${RESET}` : file.header);
    for (const hunk of file.hunks) {
      out.push(color ? `${DIM}${hunk.header}${RESET}` : hunk.header);
      for (const l of hunk.lines) {
        const gutter = (l.newLineNo != null ? String(l.newLineNo) : '').padStart(gutterWidth);
        const plain = `${gutter} ${l.text}`;
        if (!color) { out.push(plain); continue; }
        const bg = l.type === 'add' ? BG_ADDED : l.type === 'del' ? BG_REMOVED : null;
        out.push(bg ? `${bg}${padRow(plain, width)}${RESET}` : plain);
      }
    }
  }
  return out.join('\n');
}

module.exports = { parseDiff, renderRich };
```

**When to use:** This exact module, required by both `diff.js` and `show.js`.

**Confidence on this specific algorithm: MEDIUM.** The ANSI escape sequences and padding technique are well-established (verified by reasoning about terminal ANSI semantics, consistent with `diff-so-fancy`/`delta`'s documented visual behavior per the folded todo's prior-art pointers) but this exact code was not run against a real terminal this research session — the planner/implementer should write `diff-render.test.js` fixtures asserting on raw string content (not visual terminal rendering) and manually eyeball the rich output once in a real terminal before considering DIFF-01 done.

### Anti-Patterns to Avoid

- **Re-coloring `git diff --color=always` output:** Don't strip ANSI codes with a regex to reclassify lines — ask git for `--color=never` instead and classify by the unified-diff leading character (`+`/`-`/` `/`@@`). Stripping-then-reapplying is strictly more fragile.
- **Letting `compute()` call `console.log`/`console.error`/`process.stderr.write` anywhere, even for "just a warning":** `blame.js`'s existing collision warning (`process.stderr.write` at line 36, see Common Pitfalls below) is the one call site in scope that currently does this and must be converted to a prepended line in the returned string, not left as a side-effecting write — this is the exact hazard Phase 8/9's MCP server depends on this phase eliminating.
- **Making `run()` know about `--plain`:** `run()` should never need to inspect `--plain` — only `--json` (for error-shape selection). If `run()` starts branching on `--plain`, that logic has leaked out of `compute()` where it belongs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unified-diff hunk-header parsing (`@@ -a,b +c,d @@`) | A second regex in `diff-render.js` | `require('./blame-util').parseHunkHeader` (already exists, already tested) | One parser, two consumers — exactly this project's own established pattern (`updateNote()`, `shouldColor()`, `reachableFrom()` are all cited in this repo's own research docs as "one primitive, N consumers") |
| NO_COLOR/FORCE_COLOR/TTY detection | A second `shouldColor()`-equivalent inside `diff-render.js` | `require('./git').shouldColor()` | Already correct, already tested against `NO_COLOR` winning over `FORCE_COLOR` (see `diff.test.js`'s existing NO_COLOR test) — re-deriving this logic risks subtly disagreeing with the existing CLI behavior DIFF-01's `--plain` byte-identity bar depends on |
| Snapshot-sha → real-HEAD-sha resolution | A fresh lookup against `listTurns()`'s raw `sha` field inside the new `--json` branches | `require('./blame-util').parseSnapshotMessage(sha).headSha` (exact same call `log.js`/`show.js`/`cost.js` already make) | This project has shipped this exact bug twice before (v0.2, v0.3 — see PITFALLS.md Pitfall 5); the `--json` output paths are brand-new code that must reuse the already-fixed resolution, not re-derive it |
| ANSI color library | `chalk`/`ansi-styles`/`kleur` | ~6 hand-written escape-sequence constants | Narrow, fixed set of codes; adding a dependency for 6 constants contradicts this project's own precedent of hand-vendoring small, well-scoped functionality (`src/redact.js`) |

**Key insight:** Every piece of "don't hand-roll" guidance in this phase points back to the same place — this codebase already has working, tested primitives for color detection and sha resolution; the only genuinely new code is the diff-hunk-to-rich-text renderer itself, which has no existing primitive to reuse because DIFF-01 is a wholly new capability.

## Runtime State Inventory

**Not applicable to this phase.** REFACTOR-01's "refactor" is an internal code-structure change (extracting `compute()` out of `run()` inside existing files) — it is not a rename/rebrand/string-replacement/migration of any identifier that lives outside the source tree. Explicitly verified, by category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database key, collection name, or ID is being renamed. The SQLite cache schema (`src/cache.js`), ref namespace, and notes format are all untouched this phase. | None |
| Live service config | None — no external service (n8n, Datadog, etc. — not applicable to this project at all) references `run()`/`compute()` by name. | None |
| OS-registered state | None — no OS-level registration (hooks, scheduled tasks) references these function names. | None |
| Secrets/env vars | None — `NO_COLOR`/`FORCE_COLOR` env vars are read, not renamed; no secret or env var name changes. | None |
| Build artifacts | None — no package manifests or installed artifacts reference `run`/`compute` by name as an external contract. | None |

## Common Pitfalls

### Pitfall 1: `blame.js`'s stderr collision warning writes directly from the data-gathering path

**What goes wrong:** `src/commands/blame.js` line 36 calls `process.stderr.write(...)` directly inside the tracked-file branch, *before* any `console.log` of the actual blame output, to warn about duplicate `head_sha` values. If this line is left untouched during the compute/run split, `compute()` is no longer side-effect-free — it has a hidden stderr write a future MCP tool handler cannot control or suppress.

**Why it happens:** It long-predates this phase (confirmed by direct source read) and was written when `run()` was the only caller; nobody needed to make it pure.

**How to avoid:** Convert the warning into a leading line of the returned string (e.g. prepend `git turn: warning: N duplicate head_sha value(s)...` to the output), consistent with how `--json` mode would need to represent the same fact (e.g. a `"warnings": [...]` array) rather than as a side-channel stderr write that `--json` mode has no way to represent at all today.

**Warning signs:** Any `grep -n "console\.\|process\.stderr\.write\|process\.exit" src/commands/*.js` hit found anywhere outside the five `run()` function bodies after the refactor is a regression.

### Pitfall 2: `blame.js` has TWO independent output-building code paths (tracked vs. untracked-fallback) that must BOTH be converted

**What goes wrong:** `blame.js` is not a single straight-line function — it has an early `return` after the tracked-git-blame branch (lines 32-59) and a separate untracked-snapshot-fallback branch (lines 61-76) that both currently build output via per-line `console.log` calls using the same shared `formatLine()` helper. A compute/run split that only touches the first branch and misses the second (or converts both but drops the shared `formatLine()` reuse that keeps their padding from drifting) will look done after testing only the tracked-file path.

**How to avoid:** Both branches must `lines.push(formatLine(...))` into the same array and return `lines.join('\n')` at the very end of `compute()` — do not give the two branches separate `return` statements that each call `console.log` independently. `--json` similarly needs both branches to produce the same object shape (e.g. `{ file, tracked: true|false, lines: [{line, attribution, content}] }`) so a JSON consumer doesn't need to know which internal path produced the data.

**Warning signs:** A `--json` test that passes for a tracked file but a manual check against an untracked-only fixture shows plain text or a differently-shaped object.

### Pitfall 3: `cost.js`'s stderr progress indicator breaks `compute()` purity if left in place verbatim

**What goes wrong:** `cost.js` lines 91/93 write `process.stderr.write('Fetching pricing data...\r')` / the clearing whitespace directly inside what will become `compute()`'s pricing-fetch logic. Left as-is, every call to `compute()` — including from a future MCP tool handler, or from a `--json` script that doesn't care about progress UX — writes to stderr.

**How to avoid (recommended, addresses the CONTEXT.md discretion item):** Move the progress-indicator write/clear pair into `run()`, bracketing the (possibly-async) call to `compute()`:
```js
async function run(args) {
  process.stderr.write('Fetching pricing data...\r');
  try {
    const out = await compute(args);
    process.stderr.write('                        \r');
    console.log(out);
  } catch (e) {
    process.stderr.write('                        \r');
    if (args.includes('--json')) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
    console.error(e.message);
    process.exit(1);
  }
}
```
This is a one-line move (two statements relocated, zero logic change) and keeps `compute()` fully side-effect-free. It is stderr, not stdout, so it is not a protocol-corruption risk for Phase 8/9's MCP server either way (per PITFALLS.md Pitfall 2's own stderr/stdout distinction) — but purity in `compute()` is still worth the one-line move for testability (a test can call `compute()` directly without needing to swallow a stderr write).

**Warning signs:** A `compute()` unit test that doesn't stub `process.stderr.write` produces visible `\r`-laden output during `node --test` runs.

### Pitfall 4: Treating `gitSafe`'s inconsistent `stdio` overrides as a stdout-pollution risk (it isn't, but document why)

**What goes wrong (the thing CONTEXT.md flags for audit):** Several `gitSafe(...)` call sites across these five files pass `{ stdio: ['pipe', 'pipe', 'ignore'] }` (e.g. `log.js:57`, `cost.js:119`) while others pass no `stdio` option at all (e.g. `diff.js`'s and `show.js`'s `gitSafe(['diff', ...])` calls, `blame.js`'s `gitSafe(['ls-files', ...])`/`gitSafe(['blame', '--porcelain', ...])`).

**What this actually means (verified by reading `src/git.js`):** `git()` only passes a `stdio` option to `execFileSync` at all when `opts.stdio` is explicitly truthy; otherwise Node's own `execFileSync` default (`'pipe'` for all three streams) applies. Under the default, a spawned `git` subprocess's **stdout is always captured** (never passed through to the parent's stdout) regardless of whether a call site passes an explicit `stdio` override — so there is **no stdout-pollution risk from this inconsistency today**, for either the CLI or (looking ahead) a future MCP tool handler. The actual difference between "no override" and `['pipe','pipe','ignore']` is about **stderr**: with no override, a failing `git` call's stderr is captured and attached to the thrown error object (which `gitSafe` catches and discards, so even this never surfaces to the user); with the explicit `'ignore'` override, stderr is discarded immediately, before `gitSafe`'s catch would otherwise have had a chance to see it (relevant only for whichever error-message details a caller might have wanted to include, which none of these five commands currently do).

**How to avoid overclaiming the risk:** Don't "fix" this as if it were a stdout-corruption bug — it isn't one, for this phase or for Phase 8/9's MCP server, because `gitSafe` never lets a child's stdout bypass capture. Standardizing the `stdio` option across call sites (for consistency/clarity, not correctness) is a reasonable low-priority cleanup but not a blocking requirement of REFACTOR-01's "nothing reachable from `compute()` may write to stdout" acceptance bar — that bar is already satisfied by `gitSafe`'s own default behavior, with or without this cleanup.

**Warning signs:** None applicable to this phase — flagging this explicitly so the planner doesn't allocate a task to "fix" a non-bug.

### Pitfall 5: Rich-render byte counts (`added`/`removed`) must come from the SAME parse used for rendering, not a second independent count

**What goes wrong:** If `compute()`'s `--json` path computes `added`/`removed` via (e.g.) `gitSafe(['diff', '--shortstat', ...])` while the rich-text default path computes them by counting `+`/`-` lines inside `renderRich()`, the two numbers can silently disagree on edge cases (e.g. "no newline at end of file" markers, binary file diffs, mode-change-only diffs with no content lines) — exactly the kind of two-path drift this project's own retrospective (cited in PITFALLS.md) has already been bitten by once (sha-resolution drift, not diff-counting, but the same category of mistake).

**How to avoid:** `parseDiff(rawText)` (shown in Pattern 3 above) must be the single function that produces `{ added, removed }`, called by both the rich-render path and the `--json` path. Do not call `git diff --shortstat` as a second, independent count.

## Code Examples

### `run()` wrapper shape, applied uniformly to all five commands

```js
// Synchronous commands (log, show, diff, blame)
function run(args) {
  try {
    console.log(compute(args));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
    }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
```

```js
// Async command (cost) — same shape, awaited
async function run(args) {
  try {
    console.log(await compute(args));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
    }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
```

### Proposed per-command `--json` shapes (Claude's Discretion in CONTEXT.md — concrete proposal below)

All shapes below are derived from data `compute()` already has in memory before this phase (no new git calls needed beyond what each command already makes), per D-06's "natural shape per command, no shared envelope."

```js
// log --json  — bare array (matches CONTEXT.md's own example verbatim)
[
  {
    "turn": 1,
    "sha": "a1b2c3d...",            // resolved HEAD sha (parseSnapshotMessage().headSha || snapshot sha)
    "subject": "commit message subject",
    "files_changed": 3,              // null if unavailable (e.g. --no-cache fallback with no shortstat parse)
    "insertions": 10,
    "deletions": 2,
    "prompt": "why did this break"    // present only when --with-prompts AND a prompt was captured
  }
]

// show --json — turn metadata + diff, single object
{
  "turn": 3,
  "sha": "a1b2c3d...",
  "ts": "2026-10-08T12:00:00.000Z",
  "model": "claude-sonnet-4-5",       // null if not recorded
  "latency_ms": 4200,                  // null if not recorded
  "prompt": "...",                     // present only when --with-prompts AND captured
  "diff": "diff --git a/...\n...",     // raw, uncolored unified diff text — never ANSI
  "added": 12,
  "removed": 4
}

// diff --json — two-sha comparison, single object
{
  "sha_a": "parent-or-empty-tree-sha",
  "sha_b": "a1b2c3d...",
  "diff": "diff --git a/...\n...",     // raw, uncolored
  "added": 12,
  "removed": 4
}

// blame --json — per-line attribution, single object
{
  "file": "src/foo.js",
  "tracked": true,                      // false if annotated via the untracked-snapshot fallback
  "warnings": ["3 duplicate head_sha value(s) in turn history; attribution may be ambiguous"],
  "lines": [
    { "line": 1, "attribution": "f17a78b9:3", "content": "const x = 1;" },
    { "line": 2, "attribution": "(uncommitted)", "content": "const y = 2;" }
  ]
}

// cost --json — matches CONTEXT.md's own example verbatim, extended with concrete fields
{
  "session_id": "...",
  "turns": [
    { "turn": 1, "model": "claude-sonnet-4-5", "input_tokens": 1200, "output_tokens": 340, "cost": 0.0123 }
  ],
  "total_cost": 0.0123,
  "turns_with_cost": 1,
  "turns_with_model": 1,
  "model_totals": { "claude-sonnet-4-5": 0.0123 }
}
// --all mode: top-level "session_id" is omitted/replaced; each turn object gains a "session_id" field.
// Exact --all shape is an OPEN QUESTION below — not fully specified by CONTEXT.md.
```

### Error object (all five commands, `--json` mode, D-07)

```js
{ "error": "git turn: turn 99 not found" }
```
Exit code 1, same as today's non-JSON stderr path. The message text is identical to what the CLI prints today without `--json`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `run(args)` does everything, `console.log` inline, `process.exit(1)` on error | `compute(args)` returns a string or throws; `run(args)` is a thin wrapper | This phase | Makes `log`/`show`/`diff`/`blame`/`cost` safely callable in-process by a future long-lived server (Phase 8/9's MCP), with zero risk of a stray `process.exit` killing it |
| `git diff --color=always`/`--color=never` passthrough is the only diff rendering | Rich full-row-highlight rendering is default; `--plain` opts back into the old passthrough | This phase | Changes the *default* visible output of `diff`/`show` for the first time since they were written — `--plain` is the explicit escape hatch, not a deprecated fallback |
| No structured output anywhere in the CLI (`AGENTS.md` states this explicitly, twice) | `--json` on all five read commands | This phase | First-ever machine-readable CLI output; closes a documented, twice-flagged gap ahead of the MCP milestone that would otherwise have needed it anyway |

**Deprecated/outdated:** None — this phase doesn't remove any existing capability; `--plain` preserves 100% of today's `diff`/`show` behavior.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact ANSI codes `\x1b[48;5;22m` (dark green bg) / `\x1b[48;5;52m` (dark red bg) are a reasonable, readable choice for the rich renderer | Architecture Patterns, Pattern 3 | LOW — explicitly called out in CONTEXT.md as "Claude's Discretion," purely cosmetic, easy to tweak later without touching the parsing/structure logic |
| A2 | `cost --json --all` should add a `session_id` field per turn and drop the top-level single `session_id`, rather than nesting a `sessions: [...]` array | Code Examples | LOW-MEDIUM — a script consumer written against one shape would break if the planner chooses the other; worth locking down explicitly during planning rather than leaving fully openended |
| A3 | `--json` + `--plain` together: `--json` wins, `--plain` is a no-op (diff content in JSON is always raw/uncolored) | Pattern 2, Code Examples | LOW — CONTEXT.md already flags this as "likely" the right behavior; low risk either way since it only affects a flag-combination edge case, not the primary paths |
| A4 | Padding rich-diff rows to `process.stdout.columns \|\| 120` (not a fixed 80) is the right default terminal-width fallback | Pattern 3 | LOW — cosmetic; if wrong, rows are either too short (no visible full-row effect) or slightly over-wide (wraps) in unusual terminal configurations, easy to adjust |

**If this table is empty:** N/A — see entries above. None of these risk incorrect behavior, only cosmetic/shape choices explicitly deferred to this research by CONTEXT.md's own "Claude's Discretion" section.

## Open Questions (RESOLVED)

1. **Exact `cost --json --all` shape** — RESOLVED: flat shape, `session_id` field per turn (plan 07-03). Matches this section's own recommendation.
   - What we know: `cost --all` today just removes the "current session only" filter from `listTurns()`'s underlying query and otherwise renders identically.
   - What's unclear: whether `--json --all`'s turns array should carry a `session_id` field per turn (flat), or nest under a `sessions: [{session_id, turns: [...]}]` array (grouped).
   - Recommendation: flat with a `session_id` field per turn — simpler, and avoids forcing every consumer to flatten a nested structure just to compute a global total. Planner should confirm this during plan review since it's a genuine design choice, not a research-settled fact.

2. **Should `renderRich()`'s hunk/file headers (`diff --git ...`, `@@ ... @@`) get their own distinct styling (dim) beyond "default foreground, no background"?** — RESOLVED: dim (`\x1b[2m`) on headers (plan 07-01's `renderRich()` color spec). Matches this section's own recommendation.
   - What we know: CONTEXT.md's reference look (Claude Code's side panel) distinguishes added/removed/context rows via full-row background; it says nothing explicit about hunk-header styling.
   - What's unclear: whether leaving hunk headers fully unstyled looks visually disconnected from the rest of the rich rendering.
   - Recommendation: dim (`\x1b[2m`) is a safe, low-risk default (shown in Pattern 3's code) — cheap to change later since it's an isolated one-line choice, not structural.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js \>=22 | `node:sqlite` cache (unchanged), all command modules | Yes | v22.22.3 | — |
| git | Every `gitSafe` call | Yes | 2.50.1 (Apple Git-155) | — |
| TTY / `process.stdout.columns` | Rich-render row-padding width | Conditional — `columns` is `undefined` when stdout is not a TTY (e.g. piped to a file or test harness) | — | Fall back to `120` (already baked into Pattern 3's `termWidth()`) — no blocking dependency |

No missing dependencies, blocking or otherwise — this phase has no external-service or new-tool requirements at all.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`), no third-party framework |
| Config file | none — `package.json`'s `"scripts": { "test": "node --test" }` is the only config |
| Quick run command | `node --test src/commands/diff.test.js` (or `show.test.js`/`log.test.js`/`blame.test.js`/`cost.test.js`/the new `diff-render.test.js`) |
| Full suite command | `npm test` (equivalent to `node --test`, which recursively discovers every `*.test.js`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| REFACTOR-01 | `compute()` exported, returns string/throws, `run()` unchanged in observable behavior | unit | `node --test src/commands/log.test.js src/commands/show.test.js src/commands/diff.test.js src/commands/blame.test.js src/commands/cost.test.js` | ✅ (existing files, must pass with ZERO edits per acceptance bar) + ❌ new assertions calling `compute()` directly — Wave 0 |
| DIFF-01 (byte-identical `--plain`) | `diff --plain <N> [M]` / `show --plain <N>` produce identical output to pre-refactor | unit/regression | same as above, run against the `--plain` argv path | ❌ Wave 0 — new test cases needed asserting `--plain` output matches a captured pre-refactor fixture |
| DIFF-01 (rich default) | Unflagged `diff`/`show` renders gutter + summary header + full-row background, respects `NO_COLOR`/`FORCE_COLOR` | unit | `node --test src/diff-render.test.js` | ❌ Wave 0 — new file |
| JSON-01 | `--json` on all 5 commands emits parseable JSON matching the proposed shapes; error path emits `{"error": "..."}` + exit 1 | unit | `node --test src/commands/*.test.js` (new cases appended) | ❌ Wave 0 — new assertions per command file |

### Sampling Rate

- **Per task commit:** run the specific command's test file (e.g. `node --test src/commands/diff.test.js`) plus `diff-render.test.js` whenever that module changes.
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** Full suite green, plus a manual terminal eyeball of the rich-render output (ANSI rendering can't be meaningfully asserted byte-for-byte in a way that also proves visual correctness — see Pattern 3's confidence caveat).

### Wave 0 Gaps

- [ ] `src/diff-render.test.js` — new file, covers `parseDiff()`'s `{added, removed}` counting and `renderRich()`'s structural output (gutter numbers, line-type classification, summary header), both with `color: true` and `color: false`
- [ ] New test cases in each of `log.test.js`/`show.test.js`/`diff.test.js`/`blame.test.js`/`cost.test.js` directly importing and calling `compute(args)` (not just `run(args)`), asserting it returns a string (or `Promise<string>` for cost) and throws on the existing error conditions each file already tests via `run()`'s `process.exit` stub
- [ ] New `--json` test cases per command file, asserting `JSON.parse(output)` succeeds and matches the proposed shape's key fields
- [ ] New `--plain` byte-identity test cases in `diff.test.js`/`show.test.js` — capture `run(['N', '--plain'])`'s output and assert it's unchanged from a pinned pre-refactor fixture (or, simpler: assert it matches a direct `gitSafe(['diff', colorArg, shaA, shaB])` call made inline in the test, since that's exactly what `--plain` should still do)
- [ ] Framework install: none — `node --test` is already wired via `npm test`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|---------------------|
| V2 Authentication | No | Single-user local CLI tool, no auth surface |
| V3 Session Management | No | "Session" here means a git-turn agent session, not a web session — no applicable ASVS control |
| V4 Access Control | No | File-system-permission-scoped only (whatever the OS user running the CLI can read) |
| V5 Input Validation | Yes | Turn numbers already validated via `parseInt`+`isNaN` checks (unchanged this phase); `--json`/`--plain` are simple boolean flag checks (`args.includes(...)`), no injection surface since nothing is passed to a shell (this project's `execFile`-only / no-shell-interpolation rule, unchanged, applies to all `gitSafe` calls made from the new JSON/rich-render code paths too) |
| V6 Cryptography | No | No new crypto surface this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Shell injection via diff/turn arguments | Tampering | Already mitigated project-wide — `src/git.js`'s `execFileSync` never uses shell interpolation; `--json`/`--plain` flags are plain string-equality checks, not passed to any shell |
| JSON injection / malformed output breaking a downstream `jq`/script consumer | Tampering (of the consumer's parsing) | Always build the `--json` output via `JSON.stringify()` on a real object (never string-concatenate JSON by hand) — every example in this document does this; never hand-build a JSON string for error objects either |
| ANSI escape-sequence injection into rich-render output from attacker-controlled commit messages/file content | Tampering (terminal injection) | Out of this phase's threat model — `--plain`'s underlying risk already exists today (unchanged, git's own `--color=always` output could theoretically embed attacker-controlled bytes from a commit message, same as any `git log`/`git diff` user already accepts); the new rich renderer only adds its OWN fixed ANSI codes around content it does not interpret as escape sequences, so it doesn't materially increase this pre-existing, accepted risk |

## Sources

### Primary (HIGH confidence — direct source inspection this session)
- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js` — full read, every `console.*`/`process.exit` call site identified
- `/Users/scowan/Projects/scottcowan/git-turn/src/blame-util.js` — full read, confirmed `parseHunkHeader()` is generic and reusable, `parseSnapshotMessage()` is the canonical sha-resolution helper
- `/Users/scowan/Projects/scottcowan/git-turn/src/git.js` — full read, confirmed `shouldColor()` logic and `gitSafe`/`execFileSync` default `stdio` behavior (Pitfall 4's finding)
- `/Users/scowan/Projects/scottcowan/git-turn/bin/git-turn` — full read, confirmed dispatch mechanism needs zero changes beyond `--help` text
- `/Users/scowan/Projects/scottcowan/git-turn/src/commands/diff.test.js`, `show.test.js`, `log.test.js` (partial), `blame.test.js` (partial), `cost.test.js` (partial) — confirmed the console.log-capture-and-join test pattern that makes the compute/run split byte-identical by construction
- `/Users/scowan/Projects/scottcowan/git-turn/src/cache.js` — confirmed `getTurns`/`getAllTurns` row shape for `--json` field proposals
- `/Users/scowan/Projects/scottcowan/git-turn/package.json` — confirmed zero existing runtime dependencies, Node \>=22 engine requirement
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/phases/07-compute-run-split-cli-json-output/07-CONTEXT.md` — all D-01 through D-07 decisions, canonical refs
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/REQUIREMENTS.md` — REFACTOR-01, DIFF-01, JSON-01 full text
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/research/ARCHITECTURE.md` — Pattern 1 (compute/run split worked example), Anti-Pattern 2, Build Order Phase A
- `/Users/scowan/Projects/scottcowan/git-turn/.planning/research/PITFALLS.md` — Pitfalls 1-3 (stdout pollution, transitive writes, process.exit reuse), Pitfall 5 (sha-resolution regression)
- Live command checks this session: `node --version` (v22.22.3), `git --version` (2.50.1), `cat package.json` (no `dependencies` key)

### Secondary (MEDIUM confidence)
- Rich-render ANSI/padding algorithm (Pattern 3) — reasoned from general terminal-ANSI semantics and the folded todo's prior-art pointers (`diff-so-fancy`, `delta`), not independently verified against a live terminal render this session

### Tertiary (LOW confidence)
- None — no WebSearch/WebFetch was needed this session; everything required was either in this repo's own files or straightforward application of well-understood ANSI/JSON mechanics.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero dependencies, confirmed by reading `package.json` directly
- Architecture (compute/run split): HIGH — mechanical refactor, verified byte-identity reasoning against actual test harness code
- Rich diff renderer algorithm: MEDIUM — sound reasoning, not empirically rendered in a live terminal this session
- JSON schemas: MEDIUM — follow CONTEXT.md's explicit examples where given (log, cost), reasonable extrapolation elsewhere (show, diff, blame); flagged as Assumptions where genuinely open
- Pitfalls: HIGH — all five identified by direct source reading, not speculation

**Research date:** 2026-10-08
**Valid until:** No external-dependency expiry risk (zero new deps) — this research is valid until the referenced source files themselves change; re-check if `log.js`/`show.js`/`diff.js`/`blame.js`/`cost.js`/`blame-util.js`/`git.js` are modified by any other phase before Phase 7 executes.

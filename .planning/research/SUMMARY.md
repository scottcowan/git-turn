# Project Research Summary

**Project:** git-turn v0.3 — Prompt Capture
**Domain:** Git extension CLI — AI coding agent session/audit logging (prompt/response capture + mandatory secret redaction, zero-dependency Node.js)
**Researched:** 2026-09-17
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone adds a single new write path (`git turn record-prompt`) that enriches the note git-turn's post-commit hook already writes on every commit, attaching `prompt`, `model`, `latency_ms`, and `usage` fields that two existing consumers (`log`/`show --with-prompts` and `cost`) are already built to read but have never received real data for. The correct architecture is well-constrained by the existing codebase: one note object per commit in `refs/notes/git-turn`, enriched via read-merge-write (never a second note, never `git notes append`, which would corrupt the JSON), with secret redaction running synchronously and unconditionally before any write. All four research agents converge on the same critical correction to the project's own planning docs: the plan to "reuse warren's secret pattern list" is not viable — warren has no content-based secret detector (only a Fernet-encrypted credential vault and, separately, a structured key-name redaction filter for structlog events), so this milestone must budget for a genuinely new, small, hand-vendored regex + entropy scanner rather than an import.

The recommended approach is a layered detector — curated vendor-prefix regexes (AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM blocks, generic `key=value`) modeled directly on gitleaks/trufflehog's public rulesets, plus a hand-rolled Shannon-entropy fallback (ported from detect-secrets, ~10 lines of pure math, no dependency) to catch high-entropy tokens without a recognizable prefix. This keeps the zero-npm-dependency constraint intact. The single highest-leverage correctness risk is schema conformance: `cost.js` already expects `usage` in Anthropic's exact shape (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`); writing anything else fails silently (`$0.00`, no error), so this needs an explicit end-to-end test, not just unit coverage of `record-prompt` in isolation.

The dominant risk category, flagged independently by both the architecture and pitfalls research, is that `refs/notes/*` sits outside the blast radius of standard git tooling: `git notes add` is called with unconditional `-f` today (fine for a single writer, dangerous once `record-prompt` is a second writer racing the hook — read-modify-write with retry is mandatory, not optional), and both `git filter-repo` and BFG have zero documented handling of notes refs, meaning a leaked secret in a note is *stickier* than one in a commit message and survives the standard incident-response playbook. Combined with the fact that git never truly deletes overwritten note blobs until an explicit GC with reflog expiry, this makes pre-write redaction the only real control — there is no adequate remediation story, so prevention must be airtight and mandatory (no `--no-redact` escape hatch), and the `gc` command should gain a documented purge procedure in the same phase, not later.

## Key Findings

### Recommended Stack

No new npm dependencies. The stack is vendored, hand-written code: plain `RegExp` literals for known secret shapes (curated from gitleaks/trufflehog's current rulesets) plus a pure-math Shannon entropy function (ported from detect-secrets' `HighEntropyString` plugin) as a fallback for tokens with no recognizable vendor prefix. Both are well within Node 12+ (`RegExp`, `matchAll`, `Math.log2`), and git-turn's existing `node:sqlite` usage already implies a modern Node baseline, so no version risk. gitleaks/trufflehog/detect-secrets are reference implementations to copy patterns from, not runtime dependencies.

**Core technologies:**
- Curated regex list (AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM blocks, generic `key=value`) — matches the exact detection technique real scanners use, zero-dependency, ~40 lines
- Hand-rolled Shannon entropy check (base64 threshold 4.5, hex threshold 3.0, minimum run length 20) — catches unstructured high-entropy secrets patterns miss (rotated keys, custom tokens), pure math, no dependency
- `node:crypto` (optional, hashing only) — not required for detection itself, only if an audit trail of "a secret was redacted here" without storing plaintext is later desired

### Expected Features

The read side of prompt capture is already built and effectively dead code — `log.js`/`show.js` already render `meta.prompt`/`meta.model`/`meta.latency_ms`, and `cost.js` already parses `meta.usage`. The entire scope of this milestone is the writer plus the redaction gate in front of it.

**Must have (table stakes):**
- `git turn record-prompt` command — the only missing writer; everything downstream already expects its output
- Secret redaction on the write path — locked requirement, structurally mandatory (not bypassable), must run before any note write
- `usage` written in exact Anthropic-shape schema (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`) — `cost` silently shows `$0.00` on any schema drift
- `--with-prompts` end-to-end verification against real data (already implemented, untested with real content)

**Should have (competitive):**
- `git turn redact <N>` post-hoc scrub command — cheap fast-follow once `record-prompt`'s note-merge helper exists; defense-in-depth, not a substitute for pre-write redaction
- Latency capture (`latency_ms`) — must be supplied by the caller (e.g. a Claude Code Stop-hook wrapper with prompt-submit/stop timestamps); post-commit-only architecture cannot derive it internally
- Tool-call count/name summary (not full trace) — natural v0.3.x follow-on, cheap because transcript-parsing code will already exist for model/usage extraction

**Defer (v2+):**
- Full transcript/conversation storage — actively conflicts with the "notes stay small" design and multiplies redaction attack surface
- Image/multimodal prompt content — no terminal render path exists; would bloat notes with base64
- Streaming/partial note updates — conflicts with the existing serialized single-write design; no benefit for a CLI that only renders after the fact

### Architecture Approach

Prompt capture bolts onto the existing single-note-per-commit model with no new storage primitive: the post-commit hook still fires first and writes structural fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`); a new, separately-invoked `record-prompt` command performs a read-merge-write on the *same* note object, resolving its target commit via `listTurns()` + `parseSnapshotMessage()` (never bare `HEAD`, which may have moved on by the time the command runs — a previously-fixed landmine in this codebase). A new standalone `src/redact.js` scans free-text fields before they're ever passed to `addNote()`. The SQLite cache gains a `usage` column and a narrow `updatePromptFields()` UPDATE (no diff recomputation) but remains a derived, rebuildable index — never the source of truth.

**Major components:**
1. `src/redact.js` (new) — content secret-scanner (regex + entropy), standalone and independently testable, called only from the note-write path
2. `src/commands/record-prompt.js` (new) — resolves target turn, redacts, reads existing note, merges fields, overwrites via `addNote -f`, best-effort updates cache
3. `src/git.js` `getNote`/`addNote` (existing, reused as-is) — the only note-write primitive; must always be called through a merge-aware helper, never with a partial payload
4. `src/cache.js` (modified) — add `usage TEXT` column via guarded `ALTER TABLE`, extend `upsertTurn()`, add `updatePromptFields()`

### Critical Pitfalls

1. **Blind `addNote()` overwrite drops existing fields, and a second writer racing the hook causes lost updates** — build a single `updateNote(ref, sha, patchFn)` helper that always does get-note → merge → `addNote -f`; add retry-on-conflict since there's no cross-process lock around the read-modify-write window.
2. **`git notes` history-rewrite tools (filter-repo, BFG) don't cover `refs/notes/*` by default** — a leaked secret in a note survives a filter-repo pass a team believes cleaned their history; this is why redaction must be pre-write and mandatory, with no opt-out flag, and why a documented manual remediation procedure (reflog expire + `gc --prune=now` scoped to the notes ref) must ship alongside the feature.
3. **Overwriting/redacting a note does not delete the prior blob** — the old note-tree commit remains reachable via reflog until GC; "I redacted it" is not true until a purge runs. Redact before the very first write; give `gc` a purge capability in the same phase.
4. **Regex/entropy patterns tuned for structured content (config files, `.env` diffs) have real false-negative gaps against freeform conversational text** — paraphrased secrets in prose, bare high-entropy tokens with no vendor prefix, and low-entropy short secrets (a PIN, "hunter2") can all evade detection. Validate against realistic prompt/response fixtures, not just vendor-pattern unit tests, and layer entropy detection as a supplement rather than relying on prefixes alone.
5. **Standard CI secret scanners (gitleaks, trufflehog, GitHub push protection) generally don't scan `refs/notes/*` either** — don't market git-turn's redaction as "defense in depth" alongside tools that, for this specific data path, provide no coverage at all; document plainly that git-turn's pre-write scan is the primary (often only) safety net here.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Secret Redaction Scanner
**Rationale:** Zero dependencies on any other new code; must exist and be validated before any writer touches real prompt/response content, since redaction is structurally required to run in front of every note write.
**Delivers:** `src/redact.js` — vendored regex pattern list (AWS/GitHub/OpenAI/Anthropic/Slack/Google/Stripe/PEM/generic-assignment) + Shannon-entropy fallback, unit-tested in isolation against realistic prompt/response fixtures (pasted `.env` blocks, multi-line PEM keys, paraphrased secrets, low-entropy passwords) — not just vendor-pattern happy-path cases.
**Addresses:** Secret redaction on write (table stakes, locked requirement) from FEATURES.md.
**Avoids:** Pitfall 5 (pattern false negatives on freeform text) and Pitfall 6 (false sense of security from CI scanner coverage) — both require validation and documentation work that only makes sense once the scanner itself exists.

### Phase 2: Cache Schema Migration
**Rationale:** `record-prompt` needs a stable, already-migrated cache target before it exists, so users with a pre-v0.3 `cache.db` don't hit a SQL error the first time the new column is referenced.
**Delivers:** Guarded `ALTER TABLE` adding `usage TEXT` to `turns`, extended `upsertTurn()` column list, new narrow `updatePromptFields()` UPDATE helper (no diff/numstat recomputation).
**Uses:** Existing `src/cache.js` patterns (`try {} catch {}` best-effort discipline already used around `insertTurn()`).
**Implements:** Component 4 from Architecture Approach above.

### Phase 3: `record-prompt` Note-Write Path
**Rationale:** Depends on Phases 1 and 2 both existing; this is where the highest-severity correctness risk (note clobbering, lost-update races) and the highest-severity silent-failure risk (usage schema drift breaking `cost`) both live, so it needs the redaction gate and cache target already in place before it's built, and needs its own concurrency and schema-conformance tests before it ships.
**Delivers:** `src/commands/record-prompt.js` with turn resolution via `listTurns()`/`parseSnapshotMessage()` (never bare `HEAD`), a single `updateNote()` read-merge-write helper used for every write to `refs/notes/git-turn`, retry-on-conflict for the race window, best-effort cache update via `updatePromptFields()`. Wire into `bin/git-turn`'s `COMMANDS` array last, so the command isn't CLI-reachable until finished.
**Addresses:** `record-prompt` writer, `usage` schema conformance (both P1 in FEATURES.md).
**Avoids:** Pitfall 1 (note clobbering/lost-update race), Pitfall 2 (blanket `-f` hiding the "existing note" signal) — both require the merge-aware write helper to exist before the command is exposed.

### Phase 4: Verification, Remediation Docs, and Fast-Follows
**Rationale:** Once real prompt/model/usage data is flowing, the already-shipped read-side consumers (`--with-prompts`, `cost`) need end-to-end validation against real data for the first time, and the redaction-failure remediation story (which research shows has no adequate technical fix) must be documented before this ships to any user who might rely on it.
**Delivers:** End-to-end test exercising `record-prompt` → `cost` (not just unit tests in isolation) and `record-prompt` → `log --with-prompts`/`show`; documented manual remediation procedure for a leaked-then-redacted note (reflog expire + `gc --prune=now` scoped to `refs/notes/git-turn`); explicit user-facing statement that notes are outside standard CI scanner coverage and filter-repo/BFG rewrite scope. `git turn redact <N>` and latency capture are natural candidates to fold in here as low-cost fast-follows once the note-merge helper is proven.

### Phase Ordering Rationale

- Redaction must be built and validated first because every other phase's write path depends on it being unconditionally in front of `addNote()` — there is no safe order where the writer ships before the scanner.
- Cache migration comes before the command that populates it, mirroring the architecture research's explicit build-order recommendation, to avoid a broken-on-first-use column reference.
- The note-write path is deliberately isolated as its own phase because it carries the two highest-severity pitfalls (silent data loss via race/clobber, silent `cost` breakage via schema drift) — both need focused test design, not just feature completion.
- Verification/documentation is placed last but is not optional: research from both PITFALLS.md and ARCHITECTURE.md is explicit that "looks done" (writer exists, fields render) is not the same as "is done" (schema matches `cost.js` exactly, redaction survives realistic fixtures, remediation procedure exists for the case redaction fails).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Secret Redaction Scanner):** needs `--research-phase` — false-negative behavior against realistic freeform conversational text (vs. structured config files) is only reasoned about, not empirically validated, in the current research pass; building a representative fixture set is itself a research task.
- **Phase 3 (`record-prompt` Note-Write Path):** needs `--research-phase` — the cross-process race window (hook process vs. separately-invoked `record-prompt` process) has no existing lock primitive in this codebase; the concurrency/retry design needs validation, potentially via a live repro rather than pure code review.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Cache Schema Migration):** SQLite `ALTER TABLE` + guarded migration is a well-established pattern already partially precedented elsewhere in `src/cache.js`.
- **Phase 4 (Verification, Remediation Docs):** primarily testing and documentation work against already-well-understood consumers (`cost.js`, `log.js`, `show.js`); no novel technical uncertainty.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Regex patterns and entropy algorithm verified directly against current gitleaks/trufflehog/detect-secrets source on 2026-09-17; no live-fixture validation against real captured prompts yet |
| Features | MEDIUM | Grounded in direct, HIGH-confidence code inspection of this repo plus first-party Claude Code hooks docs; "typical AI session logger" competitive claims drawn from general industry knowledge, not a live competitor survey |
| Architecture | HIGH | All claims verified directly against this repo's source; one flagged gap (warren pattern-list assumption) independently corrected via direct source reading, not assumption |
| Pitfalls | MEDIUM | git-notes mechanics (`-f`, abort behavior) verified against official git docs; filter-repo/BFG notes-handling gap is confirmed by absence in official docs, not by a live repro run; race-condition and false-negative claims are reasoned from code + general git object-model behavior, not independently tested |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **"Reuse warren's secret pattern list" is a dead assumption in existing project docs** (`.planning/PROJECT.md`, the pending redaction todo): all four research agents independently confirmed, by reading warren's source directly, that no content-based secret detector exists there to reuse. Update roadmap/todo language during planning so Phase 1 is scoped as "build a new scanner" not "wire up an import."
- **No empirical validation of redaction false-negative rate against real captured prompts/responses** — the regex+entropy design is verified against upstream scanner source, but not yet tested against realistic conversational-text fixtures (pasted `.env` blocks, multi-line PEM, paraphrased secrets). Build this fixture set as part of Phase 1, not as an afterthought.
- **No live repro of the filter-repo/BFG notes-handling gap** — confirmed only by absence of documentation, not by running filter-repo against a live repo with notes. Worth a manual verification test before finalizing remediation docs in Phase 4.
- **Cross-process race window between the post-commit hook and `record-prompt`** has no existing lock primitive and no tested retry strategy — flagged for research during Phase 3 planning rather than resolved here.
- **`latency_ms` sourcing** depends on an external caller (a not-yet-built Claude Code Stop-hook wrapper script, `git-turn-note.js`, already referenced in `cost.js`'s help text but not implemented) — out of scope for this milestone's core writer but should be scoped explicitly during roadmap creation so it isn't silently assumed away.

## Sources

### Primary (HIGH confidence)
- `gitleaks/gitleaks` `config/gitleaks.toml` (fetched live, 2026-09-17) — secret regex patterns
- `trufflesecurity/trufflehog` `pkg/detectors/anthropic/anthropic.go` (fetched live, 2026-09-17) — cross-checked Anthropic key shape
- `Yelp/detect-secrets` `detect_secrets/plugins/high_entropy_strings.py` (fetched live, 2026-09-17) — Shannon entropy formula and thresholds
- `git-scm.com/docs/git-notes` (fetched directly) — `-f` overwrite semantics, abort-without-force behavior, `notes.rewrite.*` config
- Direct source inspection of this repo: `src/git.js`, `src/hooks/post-commit.js`, `src/cache.js`, `src/session.js`, `src/blame-util.js`, `src/commands/log.js`, `src/commands/show.js`, `src/commands/cost.js`, `bin/git-turn`, `.planning/PROJECT.md`
- `/Users/scowan/Projects/scottcowan/warren` source (`warren-common/src/warren_common/secrets.py`, `logging.py`) — read directly to correct the "reuse warren's pattern list" assumption

### Secondary (MEDIUM confidence)
- `git-filter-repo` README and manual (fetched directly) — absence of any `notes`/`refs/notes` mention, used as evidence of a coverage gap
- Claude Code hooks documentation (`code.claude.com/docs/en/hooks`, fetched 2026-09-17) — Stop hook payload fields, absence of model/usage/latency

### Tertiary (LOW confidence)
- BFG Repo-Cleaner notes-handling gap — inferred by analogy to filter-repo, not independently verified against official BFG documentation
- General git object-model claims about reflog/GC timing for note-tree blobs — training-data-based, not independently re-verified with a live repro
- OpenTelemetry GenAI semantic conventions ("content capture is opt-in, metadata is always-on") — general knowledge of convention design philosophy, spec page not freshly re-verified

---
*Research completed: 2026-09-17*
*Ready for roadmap: yes*

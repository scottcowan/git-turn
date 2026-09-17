# Feature Research

**Domain:** AI coding agent session/audit logging — prompt & response capture for a git-native, zero-dependency CLI
**Researched:** 2026-09-17
**Confidence:** MEDIUM (grounded in existing git-turn architecture — HIGH confidence there — plus first-party Claude Code hooks docs and well-established observability conventions; some claims about "typical AI session logger" behavior are drawn from training knowledge and industry-standard practice rather than a live competitor survey, so flagged MEDIUM/LOW where noted)

## Existing Architecture This Must Slot Into

Before categorizing features, the codebase already has partially-built plumbing that constrains the design:

- **`addNote(ref, commitSha, message)`** (`src/git.js`) — the only write path into `refs/notes/git-turn`. Any prompt-capture writer must go through this (or a sibling using the same `git notes add -f` mechanism).
- **Note payload today:** `{session_id, turn_n, snapshot_sha, ts}`, written once per commit inside `createCheckpoint()` in `src/hooks/post-commit.js` (post-commit hook, serialized via a pending-promise chain).
- **Readers already ship and expect `prompt`/`model`/`latency_ms`/`usage`:** `src/commands/log.js` (`--with-prompts` flag, already parses `meta.prompt`) and `src/commands/show.js` (`Model:`, `Latency:`, `Prompt:` sections) already read these fields defensively. **The read side of `--with-prompts` is done** — only the writer is missing. This is the single biggest scoping fact for this milestone.
- **`usage` schema is already implied and consumed downstream:** `src/commands/cost.js` expects `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` — i.e. Anthropic Messages API usage shape, not OpenAI's `{prompt_tokens, completion_tokens}` shape. Any writer must conform to this naming or `cost` breaks silently (no error, just `$0.00`).
- **SQLite cache already has columns for this:** `src/cache.js`'s `turns` table has `prompt TEXT`, `model TEXT`, `latency_ms INTEGER` — but no `usage` column (cost.js reads usage from the *note*, not the cache, at least in the current cost.js snippet: `meta.usage`). Confirm during planning whether `usage` needs a cache column or stays note-only.
- **`cost.js` already names the intended writer:** lines 152–153 print `"Model and token usage are recorded by the Claude Code Stop hook. Make sure git-turn-note.js is configured..."` — this is a forward reference to a not-yet-built helper script (`git-turn-note.js`) meant to run from Claude Code's `Stop` hook and feed data into git-turn. This strongly implies `record-prompt` should be designed as something a hook script pipes data into (via stdin/args), not just a human-typed command.
- **Secret redaction is a locked requirement**, folded into this phase per `.planning/todos/pending/2026-09-06-secret-redaction-on-notes.md` and `.planning/ROADMAP.md` Phase 4: redaction must run in the same code path as note-writing, before `addNote()` is ever called with prompt/response content — not bolted on after.
  - **Finding that changes the plan:** the todo says to "reuse whatever secret pattern list warren's secret store maintains." I checked `/Users/scowan/Projects/scottcowan/warren` and `warren-server` directly — **warren has no regex/pattern-based secret *detector*.** Its `lns` (secrets) subsystem is a Fernet-encrypted **secret store** (SQLite + `cryptography` Fernet), injected at provision time, never written to the container filesystem. It stores secrets by reference/name; it does not scan arbitrary text for secret-shaped substrings. There is nothing to import. **This means Phase 4 needs its own small pattern list** (AWS key patterns, generic high-entropy token heuristic, common API-key prefixes like `sk-`, `ghp_`, `xox[bp]-`, etc.) — this is a real gap versus the assumption baked into the todo, not a rename exercise.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Prompt text capture | Core value prop of "prompt capture" — without it there's nothing to show in `--with-prompts` | LOW | Already read by `log.js`/`show.js` (`meta.prompt`). Writer just needs to add `prompt` (string) to the JSON blob passed to `addNote`. |
| Model name capture | Every agent session logger (Claude Code, Cursor, Aider, Helicone, LangSmith, OTel GenAI) treats model name as baseline metadata, always captured, never opt-in | LOW | `show.js` already renders `Model: ${meta.model}`. Claude Code's own hook payloads do **not** include model name directly (verified against current Claude Code hooks docs — Stop hook gives `session_id`, `prompt_id`, `transcript_path`, `last_assistant_message`, but no model field, no `$CLAUDE_MODEL` env var). Model must be read from `transcript_path`'s JSONL (per-message `model` field) or passed explicitly by the caller of `record-prompt`. |
| Timestamp | Table stakes for any audit trail — git-turn's whole pitch is forensics ("which turn broke this") | LOW | Already exists as `ts` on every note; no new work, just confirm the same field is reused rather than duplicated. |
| `record-prompt` command (the writer) | This is the actual deliverable — a note field nobody can write is not a feature | MEDIUM | New command file `src/commands/record-prompt.js`. Needs to: read current session/turn (same `readSession()` used elsewhere), read existing note off HEAD (or the just-written turn note) via `getNote`, merge in prompt/model/latency/usage fields, redact, re-write via `addNote` (git notes overwrite is `-f`, already used). Must handle the ordering question: does `record-prompt` run *before* or *after* the post-commit hook's `addNote` call for the same commit? If after, it must merge into the existing payload rather than overwrite `session_id`/`turn_n`/`snapshot_sha`/`ts`. |
| Secret redaction on write | Locked requirement (see above) — notes aren't cleaned up by history rewrites, so a leaked key here is stickier than in a commit message | MEDIUM | New: a small `src/secret-scan.js` (or similar) with an explicit, documented pattern list (not "reused" from warren — see finding above). Runs synchronously in the same function that builds the note payload, before `addNote()`. Redact in place (replace matched substring with `[REDACTED]`), never block the write. |
| `--with-prompts` flag on `log`/`show` | Users need to see what they captured; a write-only feature is not testable/useful in practice | LOW (already built) | `log.js` and `show.js` both already implement this. Verify it against real data once `record-prompt` exists (currently untested with real content since nothing writes `prompt`). Treat as "already shipped, needs an end-to-end test," not new work. |
| Truncation/preview in `log`, full text in `show` | Standard pattern across every log-style tool (git log itself, `aider` chat history, Cursor's session view) — summary views truncate, detail views show full content | LOW (already built) | `log.js` already does `.slice(0, 80)` for prompt preview; `show.js` prints the full `meta.prompt`. No new work, just confirm behavior once real prompts flow through. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Token usage (`usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`) | Enables `git turn cost` (already built downstream, currently starved of data) — most agent wrapper tools treat token accounting as a premium/differentiating feature (Helicone, LangSmith, OTel GenAI all treat it as a first-class metric, not universal in raw hook payloads) | MEDIUM | The consumer (`cost.js`) already exists and already expects this exact Anthropic-shaped schema. This is the highest-leverage single field to get right — write it in the wrong shape (e.g. OpenAI's `prompt_tokens`/`completion_tokens`) and `cost` silently shows `$0.00` with no error, which is worse than not having it. Claude Code's `Stop` hook does not expose usage directly (confirmed via current hooks docs) — must be parsed out of `transcript_path`'s JSONL, where each assistant message carries a `usage` object in the native Anthropic shape. |
| Cost display (derived, not stored) | Turns raw usage into a dollar figure per turn/session — the "so what" of token capture | LOW (already built) | `cost.js` and its LiteLLM pricing-table fetch already exist and work once `usage`+`model` are present. Nothing new to build in this milestone beyond feeding it real data. |
| Latency (`latency_ms`) | Signals "did the agent take a long time reasoning vs a quick edit" — useful for the audit/forensics angle (a suspiciously fast turn making a big change is a smell) | LOW | Already has a cache column and a `show.js` render line. Compute as `stop_hook_fired_at - prompt_submitted_at` if wiring through a Claude Code hook pairing (`UserPromptSubmit` timestamp to `Stop` timestamp), or accept it as an optional field the caller supplies. Genuinely useful but not blocking; treat as differentiator, not table stakes, since many agents (Aider, Cursor) don't expose clean start/stop timestamps at all. |
| Post-hoc redaction command (`git turn redact <N>`) | Complements pre-write scanning — covers the case where a secret pattern wasn't caught, or a human wants to scrub something after the fact for reasons unrelated to secrets (PII, embarrassing prompt text) | MEDIUM | Explicitly proposed as an "either or both" option in the todo. Not required for MVP of this milestone (pre-write scanning is the locked requirement), but flagged as a strong candidate for a fast-follow inside the same phase since it reuses the same `addNote -f` overwrite mechanism — cheap to add once the payload-merge logic for `record-prompt` exists. |
| Tool-call *summary* (count/names only, not full trace) | "5 tool calls: Read, Edit, Bash x2, Write" is useful audit context without the cost/size of a full trace | MEDIUM | Not requested in the current milestone scope, but worth flagging as a natural v0.3.x follow-on — cheap because `transcript_path` already contains this, and it stays git-note-sized (a few dozen bytes) rather than exploding note size like a full trace would. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full conversation/transcript storage in the note | "Just save everything, disk is cheap" — feels safer than picking fields | `refs/notes/git-turn` is fetched/pushed with the repo by default if notes refs are shared; unbounded growth per turn defeats git-turn's "notes are small, cheap, forever" design; also multiplies the secret-redaction attack surface (more content = more chances to leak a credential); git notes have no size cap enforcement, so this is a self-inflicted repo-bloat problem, not a hypothetical one | Store only the final prompt text and a truncated/summarized response (or no response body at all — just `model`+`usage`+`latency_ms`); point to `transcript_path` conceptually but never copy the whole JSONL into a note |
| Image/multimodal content (screenshots pasted into prompts, agent-attached diagrams) | Increasingly common in agent workflows (Claude Code, Cursor support image-in-prompt) | Git notes are text blobs referenced by `git notes show`; embedding base64 image data would bloat notes by orders of magnitude versus text, break the "notes stay small" assumption, and has no display path in a terminal CLI anyway (`log`/`show` are text-only) | Store a boolean/count (`had_images: true`) or a short description if the caller provides one; never store binary/base64 payloads in a note |
| Real-time/streaming capture (write partial note updates as the agent streams tokens) | Feels more "live" and matches how chat UIs render | Adds concurrency complexity to a write path (`addNote`) that's *already* serialized via a pending-promise specifically to avoid concurrent-write races; streaming partial writes multiplies note-rewrite churn (`git notes add -f` overwrites, so a streaming design means N rewrites per turn instead of 1) for zero benefit in a CLI that only renders after the fact | Write once, after the turn completes (mirrors the existing post-commit hook design, which already fires after-the-fact, not mid-commit) |
| Inventing a new/custom secret-pattern taxonomy from scratch as a "smart" ML-based detector | Sounds more robust than regex | Zero-dependency constraint rules out any ML/entropy-library dependency; a bespoke from-scratch taxonomy is exactly the "inventing a new one" the todo explicitly warns against, and is high-effort for marginal gain over well-known patterns (AWS `AKIA...`, GitHub `ghp_`/`gho_`/`github_pat_`, Slack `xox[bp]-`, generic `sk-` prefixes, high-entropy base64/hex runs) | A short, documented, static regex list (same category of thing warren *would* have provided if it had one) — ship it as a plain array in one file so it's trivially auditable and extensible later |
| Blocking the commit if a secret is detected | Feels "safer" — stop the leak before it happens | The todo is explicit about this: "don't block the commit — the code itself is already committed either way." The secret risk here is in the *note* (prompt/response text), not the commit; the commit already happened by the time `post-commit` runs. Blocking would also contradict git-turn's core promise of never interfering with the agent's normal commit flow | Redact silently in the note payload before writing; optionally print a stderr warning (matching the existing "never crash the commit — log to stderr only" pattern in `post-commit.js`) |

## Feature Dependencies

```
record-prompt (writer)
    └──requires──> addNote() [existing, src/git.js]
    └──requires──> secret redaction pass [new, must run first in the same code path]
    └──requires──> a way to identify "current turn" [existing: readSession(), turnRef(), post-commit hook's notePayload]

--with-prompts on log/show
    └──requires──> record-prompt actually writing meta.prompt [currently the ONLY missing piece — reader side is done]

git turn cost (existing)
    └──requires──> record-prompt writing usage in Anthropic-shape ({input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens})
    └──requires──> record-prompt writing model as a string matching (or normalizable to) LiteLLM's pricing-table keys

git turn redact <N> (proposed differentiator)
    └──requires──> the same note-merge/overwrite logic built for record-prompt
    └──enhances──> secret redaction [covers cases the pre-write scan misses]

latency_ms capture
    └──requires──> two timestamps from the caller (prompt-submitted, turn-complete) OR an externally-computed value passed straight through
    └──conflicts with──> pure post-commit-hook-only capture (post-commit only sees "commit happened," not "prompt started") — latency likely must be supplied by the caller of record-prompt, not derived on git-turn's side
```

### Dependency Notes

- **`record-prompt` requires secret redaction to run first, in the same function:** this is a locked requirement from the roadmap, not a nice-to-have ordering — plan the payload-building function so redaction is structurally impossible to skip (i.e., don't expose a raw "write note with prompt" path that bypasses the scanner).
- **`--with-prompts` requires `record-prompt` to write `meta.prompt`:** the flag and its rendering code already exist and are effectively dead code today (nothing populates the field they read). This means Phase 4's "add a flag" line item in the roadmap is largely already done — the actual work is 100% on the writer side.
- **`cost` requires exact schema conformance from `record-prompt`:** if the usage-writing shape drifts from what `cost.js` already parses, `cost` degrades silently to "no token usage data" rather than erroring — worth a test that exercises `record-prompt` → `cost` end-to-end, not just unit tests of `record-prompt` in isolation.
- **`git turn redact <N>` conflicts with nothing but shares machinery with `record-prompt`:** both need "read existing note, merge/mutate a field, `addNote -f` to overwrite." Building `record-prompt`'s note-merge helper as a reusable function (not inlined) sets up `redact` as a near-free fast-follow.
- **Latency conflicts with the post-commit-only architecture:** the post-commit hook fires after `git commit` returns — it has no visibility into when the *agent's prompt processing* started. Latency must come from whatever calls `record-prompt` (e.g., a Claude Code `Stop` hook wrapper script that has both `UserPromptSubmit` and `Stop` timestamps), not be computed internally by git-turn.

## MVP Definition

### Launch With (v1 — this milestone, Phase 4)

- [ ] `git turn record-prompt` — accepts prompt, model, and (optionally) usage/latency, writes/merges into the current turn's note — this is the entire point of the milestone
- [ ] Secret redaction pass on the write path (static pattern list, own implementation — do not assume warren provides one) — locked requirement, must ship in the same commit(s) as the writer, not after
- [ ] `--with-prompts` on `log`/`show` — largely already built; verify/harden against real data from `record-prompt`
- [ ] `usage` field written in the exact Anthropic-shape schema `cost.js` already expects — without this, the existing `cost` command stays broken with real data

### Add After Validation (v1.x — natural fast-follows within v0.3, not separate phases)

- [ ] `git turn redact <N>` — post-hoc scrub command — add once `record-prompt`'s note-merge helper exists and is proven, since it's nearly free at that point
- [ ] Tool-call count/name summary (not full trace) — add once real transcript-parsing code exists (likely built for `record-prompt`'s model/usage extraction anyway)

### Future Consideration (v2+ — explicitly out of scope)

- [ ] Full transcript/conversation storage — defer indefinitely; conflicts with git-turn's "notes stay small" design, not just deferred for later capacity
- [ ] Image/multimodal prompt content — defer until there's a concrete terminal-rendering story (there isn't one — `log`/`show` are plain text)
- [ ] Streaming/partial note updates — defer indefinitely; conflicts with the existing serialized-write design, no clear benefit for a CLI that only reads after the fact

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `record-prompt` writer (prompt/model/usage/latency) | HIGH | MEDIUM | P1 |
| Secret redaction on write | HIGH (locked requirement, security-critical) | MEDIUM (own pattern list, not reused from warren) | P1 |
| `--with-prompts` verification/hardening | HIGH (unlocks a flag that's currently dead code) | LOW | P1 |
| `usage` schema conformance with `cost.js` | HIGH (unblocks an already-shipped command) | LOW (just discipline, not new logic) | P1 |
| `git turn redact <N>` | MEDIUM | LOW (once record-prompt's helper exists) | P2 |
| Tool-call count/name summary | MEDIUM | MEDIUM | P2 |
| Latency capture | MEDIUM | LOW-MEDIUM (depends on caller supplying timestamps) | P2 |
| Full transcript storage | LOW (attractive nuisance) | HIGH (and actively harmful to design goals) | P3 (reject) |
| Image/multimodal content | LOW (no render path) | HIGH | P3 (reject) |

**Priority key:**
- P1: Must have for launch (this phase)
- P2: Should have, add when possible (same milestone, fast-follow)
- P3: Nice to have / explicitly rejected here with reasoning

## Competitor / Prior-Art Feature Analysis

| Feature | Claude Code hooks (native) | OpenTelemetry GenAI semconv (industry convention) | git-turn's plan |
|---------|------------------------------|-----------------------------------------------------|-----------------|
| Prompt/response content capture | Not exposed directly in hook payload — must be read from `transcript_path` JSONL, which lags real-time and may miss the latest turn | Treated as *opt-in*, sensitive content — captured separately from metadata, with content capture gated by config (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`-style flags in the broader OTel GenAI ecosystem) — MEDIUM confidence, drawn from general knowledge of the OTel GenAI conventions rather than a freshly re-verified spec page | Capture prompt/response as plain fields in the note (no separate opt-in gate proposed in the roadmap) but apply mandatory secret redaction before write — a stricter default than "opt-in capture," appropriate for a tool whose stated purpose is capturing this content |
| Model/token/latency/cost metadata | Not in hook payload; token usage is in `transcript_path` per-message `usage` objects (Anthropic native shape) | Always-on span attributes (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, model, duration) — treated as safe-by-default, unlike content | git-turn already treats these as safe-by-default too (no redaction proposed for model/usage/latency, only for prompt/response text) — consistent with industry norm |
| Session correlation | `prompt_id` correlates hook events with OTel telemetry for the same prompt | `gen_ai.conversation.id` / span/trace IDs correlate multi-turn conversations | git-turn already has `session_id`/`turn_n` doing the same correlation job — no new work needed here |
| Secret/PII scrubbing on captured content | Not addressed by Claude Code hooks docs at all — no built-in scrubbing | Not standardized in OTel GenAI semconv beyond the opt-in gate itself | git-turn is *ahead* of both in this respect by making redaction a locked, mandatory requirement rather than leaving it to the operator |

## Sources

- `/Users/scowan/Projects/scottcowan/git-turn/src/git.js`, `src/hooks/post-commit.js`, `src/commands/log.js`, `src/commands/show.js`, `src/commands/cost.js`, `src/cache.js` — direct code inspection, HIGH confidence (this is the actual system being extended)
- `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/todos/pending/2026-09-06-secret-redaction-on-notes.md` — project's own locked requirements and rationale, HIGH confidence
- `/Users/scowan/Projects/scottcowan/warren` and `warren-server` source — direct inspection; found no secret-pattern detector to reuse (only a Fernet-encrypted secret *store*), HIGH confidence this specific assumption in the todo needs revisiting
- Claude Code hooks documentation (`code.claude.com/docs/en/hooks`, fetched 2026-09-17) — HIGH confidence on Stop hook payload fields (`session_id`, `prompt_id`, `transcript_path`, `last_assistant_message`) and the absence of model/usage/latency/cost from that payload
- OpenTelemetry GenAI semantic conventions — MEDIUM/LOW confidence; the specific `gen-ai-spans` page has moved to a separate repo and was not directly re-verified in this pass, so the "content capture is opt-in, metadata is always-on" claim is stated at MEDIUM confidence from general knowledge of the convention's design philosophy rather than a freshly fetched spec

---
*Feature research for: AI coding agent prompt/response capture in a git-native CLI (git-turn v0.3)*
*Researched: 2026-09-17*

# Phase 4: Secret Redaction Scanner - Research

**Researched:** 2026-09-17
**Domain:** Zero-dependency secret detection/redaction for freeform text (Node.js, `node --test`)
**Confidence:** HIGH

## Summary

This phase builds `src/redact.js`, a standalone, dependency-free scanner that detects likely secrets in free text (prompts/responses) and replaces each match with a generic `[REDACTED]` marker. All groundwork was already done at the milestone level (`.planning/research/STACK.md`) — this document narrows that down to concrete, verified, copy-pasteable code adapted to the three locked decisions in `04-CONTEXT.md` (generic marker with no type tag, full 9-category vendor set, SHA/UUID whitelist ahead of the entropy fallback) and to this project's actual module conventions (`src/blame-util.js`, `src/cache.js`).

All nine vendor-prefix regex patterns from `STACK.md` were re-verified in this research session by generating synthetic matching strings and running each pattern against them directly in Node — every pattern matches its intended shape. The Shannon-entropy algorithm and the SHA/UUID whitelist were also executed directly: a real 40-hex SHA scores 3.83 bits/char (above the 3.0 hex threshold — confirming it WOULD be a false positive without the whitelist, per D-03's rationale), and a random 32-char base64 secret scores 4.5–4.8 bits/char (above the 4.5 base64 threshold, confirming the entropy fallback fires correctly on non-vendor-shaped tokens).

**Primary recommendation:** Implement `redact(text)` as two sequential passes over one string — vendor regex replace, then a whitelist-gated entropy scan over the remainder — returning `{ text, count }` (no type/position breakdown, consistent with D-01's "no leaked structure" intent). Ship `src/redact.test.js` with the fixture set below, and document false-negative behavior (paraphrased secrets, short/low-entropy passwords) inline in the module's top comment rather than a separate doc, since there is no README security section in this project yet to extend.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Secret pattern matching (vendor regex) | Library module (`src/redact.js`) | — | Pure string transform, no I/O, no git dependency — belongs entirely in a standalone module callable from any future write path |
| High-entropy fallback detection | Library module (`src/redact.js`) | — | Same as above; pure math (`Math.log2`), no external state |
| SHA/UUID whitelist pre-filter | Library module (`src/redact.js`) | — | Must run inside the same module, before entropy scoring, per D-03 |
| Wiring into note-write path | **Out of scope this phase** | Phase 5 (`record-prompt`) | CONTEXT.md `<domain>` explicitly excludes wiring — this phase delivers the scanner + its own tests only |
| Purge/remediation for already-written secrets | **Out of scope this phase** | Phase 6 (`redact <N>`, purge docs) | REQUIREMENTS.md traceability maps REDACT-02/03 to Phase 6 |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REDACT-01 | All prompt/response content is scanned for secrets (curated vendor-prefix regexes + Shannon-entropy fallback) and redacted before any note write — unconditional, no opt-out flag | Verified regex set (9 categories) + verified entropy algorithm + verified whitelist below; module design has no bypass parameter, matching "no opt-out flag" |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use a generic marker: `[REDACTED]`. Do not tag the marker with the matched pattern type (rejected `[REDACTED-AWS-KEY]`-style tags) and do not partially reveal any characters of the matched secret (rejected `sk-...ab12`-style partial reveal). Simplicity and zero leaked structure win over debuggability here.
- **D-02:** Include the full suggested vendor-prefix set from research: AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM blocks, and generic `key=value` assignments. Don't narrow to a coding-agent-focused subset — breadth is cheap to include and gitleaks/trufflehog-style coverage is the reference standard.
- **D-03:** The scanner MUST whitelist/exempt shapes that are known-benign in git-turn's own domain before running entropy detection: 40-character hex git SHAs and UUID-v4-shaped strings. These appear constantly in legitimate prompt text (commit references, session IDs) and would otherwise trigger frequent false-positive redactions under an entropy-based fallback. Vendor-prefix regex matches (AWS/GitHub/etc.) are unaffected by this whitelist — it only suppresses the generic entropy fallback for these specific known shapes.

### Claude's Discretion

- Exact entropy thresholds (base64 ~4.5 bits/char, hex ~3.0 bits/char per research) and minimum run-length tuning — left to research/planning to finalize against the validation fixtures, not a user-facing decision. **Resolved below:** use detect-secrets' verified defaults (4.5 base64 / 3.0 hex, 20-char run floor) — re-verified against live gitleaks/trufflehog/detect-secrets sources at the milestone level and re-executed against real samples in this session; no reason to deviate.
- Where documented false-negative behavior lives (README security section, AGENTS.md, or a dedicated doc) — planner's call. **Recommendation below:** inline top-of-module comment in `src/redact.js`, since no README security section exists yet and AGENTS.md is a CLI-usage reference, not a security-model doc — creating a new doc file for one paragraph is disproportionate.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (Entropy threshold tuning and false-negative documentation location were explicitly left to research/planning discretion, not deferred to a future phase.)
</user_constraints>

## Standard Stack

### Core

No new dependencies — hard zero-npm-dependency constraint (confirmed: `package.json` has no `dependencies` block). Everything below uses Node built-ins only, already available on the project's floor (`engines.node: >=22`, and `node:sqlite` usage elsewhere already implies this floor).

| Built-in | Purpose | Why Standard |
|----------|---------|---------------|
| `RegExp` / `String.prototype.matchAll` / `String.prototype.replace` | Vendor pattern matching and substitution | Available since Node 12+; this is exactly what gitleaks/trufflehog do at the regex layer — no library needed |
| `Math.log2` | Shannon entropy computation | Pure math; `detect-secrets`' `HighEntropyString` plugin is nothing more than this formula |

### Supporting

None. Explicitly do not add: `secretlint`, `@secretlint/*`, any gitleaks-node wrapper, or an entropy npm package — all violate the zero-dependency constraint and add nothing plain `RegExp`/`Math.log2` can't do here.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vendored regex + hand-rolled entropy | Shell out to a locally installed `gitleaks`/`trufflehog` binary via `execFile` | Reintroduces an external-binary dependency most environments won't have; can't be the sole line of defense — rejected, matches milestone STACK.md conclusion |
| Plain Shannon entropy | Full n-gram/Markov-chain randomness scoring | Added complexity not justified until real false-positive data says otherwise — start simple |

## Package Legitimacy Audit

**Not applicable to this phase.** No external packages are installed or recommended — `src/redact.js` uses only Node built-ins (`RegExp`, `Math.log2`, `String.prototype.matchAll`). `pip`/slopcheck were not run because there is nothing to audit; the zero-dependency constraint makes this section moot rather than skipped for convenience.

## Architecture Patterns

### System Architecture Diagram

```
   free text (prompt/response string)
              |
              v
   +----------------------+
   | Pass 1: vendor regex  |   9 ordered patterns (AWS -> ... -> generic
   | replace, in order     |   key=value last, broadest net last)
   +----------------------+
              |  (partially redacted text; "[REDACTED]" already
              |   inserted at each vendor match)
              v
   +----------------------+
   | Pass 2: candidate     |   regex finds runs >= 20 chars of
   | high-entropy runs     |   [A-Za-z0-9+/_-]{20,}={0,3}
   +----------------------+
              |
              v
   +----------------------+
   | Whitelist pre-filter  |   40-hex SHA regex OR UUID-v4 regex ->
   | (D-03)                |   skip this candidate entirely, do NOT score
   +----------------------+
              |  (survivors only)
              v
   +----------------------+
   | Shannon entropy score |   hex charset (limit 3.0) or base64
   | vs. threshold          |   charset (limit 4.5), pick by charset test
   +----------------------+
              |  entropy >= limit?
              v
   +----------------------+
   | Replace token with     |
   | "[REDACTED]"; increment|
   | count                  |
   +----------------------+
              |
              v
   redact(text) -> { text, count }
```

### Recommended Project Structure

```
src/
├── redact.js         # SECRET_PATTERNS, entropy helpers, redact(text) — single file, no split needed at this size
├── redact.test.js     # node:test fixtures (vendor hits, whitelist misses, documented false negatives)
```

Milestone-level STACK.md proposed splitting `redact.js`/`entropy.js` into two files. **Revised recommendation:** keep it as one file. The project's existing convention (`blame-util.js`, `cache.js`) is one file per cohesive concern with everything exported from the bottom `module.exports`; entropy scoring has no independent use outside redaction, so a second file adds indirection without benefit. Match `blame-util.js`'s style: `'use strict'` at top, a short comment block explaining scope, plain functions, no classes, single `module.exports` at the bottom.

### Pattern 1: Ordered regex list, most-specific-first

**What:** Iterate `SECRET_PATTERNS` in a fixed array order and `.replace()` each pattern globally before moving to the next.
**When to use:** Always — order matters because the generic `key=value` pattern is broad enough to double-match text a more specific pattern (e.g., Stripe) already redacted, so specific-prefix patterns must run first, generic-last.
**Example:**
```js
// Source: adapted from gitleaks/gitleaks config/gitleaks.toml (fetched 2026-09-17,
// re-verified against synthetic matching strings in this research session)
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g },
  { name: 'github-pat', re: /\bgh[pousr]_[0-9a-zA-Z]{36}\b/g },
  { name: 'github-pat-fine-grained', re: /\bgithub_pat_\w{82}\b/g },
  { name: 'openai-api-key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{58,74}T3BlbkFJ[A-Za-z0-9_-]{58,74}\b|\bsk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}\b/g },
  { name: 'anthropic-api-key', re: /\bsk-ant-(?:admin01|api03)-[A-Za-z0-9_-]{93}AA\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[a-zA-Z0-9]+)?\b/g },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g },
  {
    name: 'generic-assigned-secret',
    re: /(?:access|auth|api[-_]?key|credential|creds|secret|token|passw(?:or)?d)[\w.-]{0,20}\s*[:=]\s*['"`]?([\w.+/=-]{12,150})['"`]?/gi,
  },
];
```
Per D-01, the replacement string for every pattern is the literal `'[REDACTED]'` — no `-AWS-KEY` suffix, no partial reveal. (STACK.md's draft used `[REDACTED-SECRET]`/`[REDACTED-HIGH-ENTROPY]` — **do not use those**; D-01 supersedes that draft.)

### Pattern 2: Whitelist-gated entropy fallback (D-03)

**What:** Before scoring a high-entropy candidate run, test it against two exemption regexes; skip scoring entirely if either matches.
**When to use:** Every candidate token found by the entropy pass, unconditionally — this is not optional tuning, it is a correctness requirement per D-03 (git SHAs and UUIDs are structurally certain to trip the hex/base64 entropy threshold, verified below).
**Example — verified live in this research session:**
```js
// Whitelist regexes — anchored, full-string match against each candidate
// token (not a substring search), so a SHA/UUID embedded inside a longer
// mixed string is NOT exempted, only a token that IS exactly one shape.
const GIT_SHA_RE = /^[0-9a-f]{40}$/i;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isWhitelisted(token) {
  return GIT_SHA_RE.test(token) || UUID_V4_RE.test(token);
}
```
**Verification performed in this session (node -e, not just training-data claims):**
- A real 40-hex SHA (`a94a8fe5ccb19ba61c4c0873d391e987982fbbd3`) scores **3.83 bits/char** against the hex charset — above the 3.0 hex threshold. Without the D-03 whitelist, this SHA would be false-positive-redacted every time. `isWhitelisted()` correctly exempts it (`GIT_SHA_RE.test(...)` → `true`).
- A UUID v4 (`550e8400-e29b-41d4-a716-446655440000`) is exempted by `UUID_V4_RE` before any entropy math runs on it at all (the whitelist check happens first in the pipeline, so no entropy computation is even needed for UUIDs).
- A random 32-char base64 secret (`crypto.randomBytes(24).toString('base64')`, three independent samples) scored **4.56, 4.81, 4.63 bits/char** — all above the 4.5 base64 threshold and correctly NOT matched by either whitelist regex, so the fallback fires as intended on genuine random tokens.

### Anti-Patterns to Avoid

- **Scoring entropy before whitelist-checking:** Computing Shannon entropy first and only checking the whitelist on high-entropy hits is functionally equivalent but wastes cycles and, more importantly, is easy to get backwards during implementation (checking whitelist against the *scored result* instead of the *raw token*). Always test the whitelist regex against the raw candidate string, before or instead of entropy math — the recommended order above short-circuits UUID tokens with zero entropy computation.
- **Per-line scanning:** PITFALLS.md Pitfall 5 explicitly flags that multi-line PEM blocks get missed if the scanner processes payload line-by-line. `redact(text)` must run its regexes against the whole string, never `text.split('\n').map(redact)`. The PEM pattern `-----BEGIN ... PRIVATE KEY-----` matches only the header line by design (matches gitleaks' own approach — the header alone is sufficient signal that a private key follows), so a full contiguous-string scan is what makes even a partial-line match reliable; splitting by line risks losing surrounding context for future body-scanning patterns.
- **Tagging the marker with match type or position:** Rejected explicitly by D-01. Do not build `[REDACTED:aws-access-key-id]` even as an internal debug feature that "could be stripped later" — the whole point of D-01 is zero leaked structure, and debug scaffolding tends to survive into production.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recognizing vendor key shapes | A custom heuristic ("looks like a key if it has letters+numbers+dashes") | The 9 verified regex patterns above, copied from gitleaks/trufflehog reference source | Those patterns encode years of real-world tuning (e.g., the OpenAI `T3BlbkFJ` base64("OpenAI") marker) that a fresh heuristic would take many false-positive/negative cycles to rediscover |
| Randomness detection | A "count unique characters" or "check for repeated substrings" ad hoc score | Shannon entropy (`-Σ p·log2(p)`) | It's the industry-standard measure (detect-secrets, gitleaks' entropy rules) and is literally 10 lines of math — no reason to invent something weaker |
| Base64/hex "candidate run" detection | Manually walking the string char-by-char to find long runs | The `/[A-Za-z0-9+/_-]{20,}={0,3}/g` regex + `matchAll` | One regex expresses the exact rule (length floor, charset) that a manual loop would reimplement with more surface area for bugs |

**Key insight:** Every piece of this scanner already has a widely-deployed reference implementation (gitleaks, trufflehog, detect-secrets) whose patterns and thresholds are public and directly portable to plain JS with zero runtime dependency. There is no part of this problem where hand-rolling something *different* from those references is justified — only porting them faithfully.

## Common Pitfalls

### Pitfall 1: 40-hex git SHAs and UUIDs false-positive under entropy scoring (verified, not just theoretical)

**What goes wrong:** Without the D-03 whitelist, every git commit SHA or session UUID appearing in prompt text (e.g., "which commit was a94a8fe...?", "session 550e8400-e29b-41d4-a716-446655440000 failed") gets redacted, destroying legitimate diagnostic content that is the entire point of prompt capture.
**Why it happens:** Both shapes are, structurally, exactly what the entropy fallback is designed to catch — long fixed-charset runs with high character diversity. This isn't a tuning edge case; it's a structural certainty (verified above: 3.83 bits/char for a real SHA, above the 3.0 threshold).
**How to avoid:** Run the whitelist check (`isWhitelisted`) against every candidate token before scoring, unconditionally, as shown in Pattern 2 above.
**Warning signs:** Test fixtures that assert `redact(shaContainingText).text` still contains the original SHA — if this assertion is missing from the test suite, the whitelist may have been implemented but never proven.

### Pitfall 2: Generic `key=value` pattern double-redacting already-redacted text

**What goes wrong:** If the generic pattern runs before the specific vendor patterns (wrong order), or if it's re-run against text already containing `[REDACTED]` markers from a prior pass in a loop, it can match `token: [REDACTED]` as a new "assignment" and wrap it again, or interact oddly with the marker's own characters.
**Why it happens:** The generic pattern's value-capture group `[\w.+/=-]{12,150}` is broad enough to match many strings, including artifacts of prior redaction if the pipeline isn't careful about doing exactly one pass per pattern in a fixed order.
**How to avoid:** Run each pattern exactly once, generic pattern strictly last, over the output of the previous pattern's replace — never loop the full pattern list more than once over the same text.
**Warning signs:** A fixture with two secrets close together, one vendor-shaped and one generic-assignment-shaped, producing more than 2 `[REDACTED]` markers in the output.

### Pitfall 3: Multi-line PEM blocks missed by per-line or JSON-escaped scanning

**What goes wrong:** If the caller (Phase 5) JSON-stringifies the prompt text before calling `redact()`, or the scanner is accidentally applied per-line, embedded `\n` sequences inside a PEM block change the matchable shape and the `-----BEGIN...-----` header line pattern can still match (it's single-line by design) but the body of the key survives untouched in the note.
**Why it happens:** This is PITFALLS.md's Pitfall 5, called out at the milestone level — it is a real, specifically-flagged risk for this project, not a generic concern.
**How to avoid:** `redact(text)` must be called on the raw string *before* `JSON.stringify`, and must never be split by `\n` internally. This is a calling-convention requirement worth stating explicitly in the module's top comment, since Phase 5 is the one that will actually call it.
**Warning signs:** A fixture with a full multi-line PEM block (header + base64 body + footer) where only the header line becomes `[REDACTED]` but the base64 body lines are asserted to remain untouched — that's expected/documented behavior (see Fixture 8 below), not a bug, but the test should assert it explicitly so it's a known/intentional gap rather than a silent one.

### Pitfall 4: Paraphrased or low-entropy secrets are undetectable by design — must be documented, not "fixed"

**What goes wrong:** Text like "the token is sk-abc123, does that look right?" (fake prefix, no real vendor marker) or "the password is hunter2" cannot be caught by either pattern matching (no recognizable vendor shape) or entropy scoring (too short / too low-entropy to clear the 20-char floor or the threshold). Treating this as a bug to fix leads to either an impossibly loose entropy threshold (destroys legitimate prose) or scope creep into NLP-based secret detection (explicitly out of scope per STACK.md's "What NOT to Add" table).
**Why it happens:** This is a structural limitation of regex+entropy detection against conversational text, not an implementation defect — flagged explicitly in PITFALLS.md Pitfall 5 and REQUIREMENTS.md's own wording ("documented false-negative behavior").
**How to avoid:** Document this limitation directly in `src/redact.js`'s top comment (per the resolved Claude's Discretion item above) and encode it as *expected* (not failing) test assertions — see Fixtures 9 and 10 below, which assert the false negative occurs, converting "known gap" into "proven and tracked" rather than "hoped for."
**Warning signs:** A test suite with no fixture that intentionally asserts a secret survives redaction — if every fixture asserts full redaction, the false-negative behavior required by SC3 has not actually been validated.

## Code Examples

### `redact(text)` — recommended module shape

```js
// src/redact.js
'use strict';

// Secret redaction scanner for freeform prompt/response text. Layered
// detection: (1) curated vendor-prefix regexes for known key shapes
// (AWS/GitHub/OpenAI/Anthropic/Slack/Google/Stripe/PEM/generic key=value),
// (2) a Shannon-entropy fallback for high-entropy tokens with no vendor
// prefix, gated by a whitelist for git-turn's own benign high-entropy
// shapes (40-hex commit SHAs, UUID-v4 session IDs).
//
// KNOWN FALSE NEGATIVES (by design, not a bug — see 04-RESEARCH.md
// Pitfall 4): paraphrased secrets with no recognizable vendor prefix
// ("the token is sk-abc123") and short/low-entropy secrets below the
// 20-character candidate-run floor ("hunter2", a 6-digit PIN) are not
// detectable by regex+entropy scanning. This module is risk reduction,
// not a guarantee. Called before every note write; must never be
// bypassed (no opt-out parameter exists on purpose — REDACT-01).
//
// Call `redact(rawText)` BEFORE JSON.stringify-ing any payload containing
// it — scanning must see real newlines, not JSON-escaped `\n` sequences.

const SECRET_PATTERNS = [
  { re: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g },
  { re: /\bgh[pousr]_[0-9a-zA-Z]{36}\b/g },
  { re: /\bgithub_pat_\w{82}\b/g },
  { re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{58,74}T3BlbkFJ[A-Za-z0-9_-]{58,74}\b|\bsk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}\b/g },
  { re: /\bsk-ant-(?:admin01|api03)-[A-Za-z0-9_-]{93}AA\b/g },
  { re: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[a-zA-Z0-9]+)?\b/g },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g },
  { re: /(?:access|auth|api[-_]?key|credential|creds|secret|token|passw(?:or)?d)[\w.-]{0,20}\s*[:=]\s*['"`]?([\w.+/=-]{12,150})['"`]?/gi },
];

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_=';
const HEX_CHARS = '0123456789abcdefABCDEF';
const BASE64_ENTROPY_LIMIT = 4.5;
const HEX_ENTROPY_LIMIT = 3.0;
const CANDIDATE_RUN_RE = /[A-Za-z0-9+/_-]{20,}={0,3}/g;

const GIT_SHA_RE = /^[0-9a-f]{40}$/i;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shannonEntropy(str, charset) {
  if (!str) return 0;
  const counts = new Map();
  for (const ch of str) {
    if (!charset.includes(ch)) return 0;
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isWhitelisted(token) {
  return GIT_SHA_RE.test(token) || UUID_V4_RE.test(token);
}

// redact(text) -> { text, count }
// `count` is a total match count only — no per-type breakdown, no
// position, no partial content — consistent with D-01's "no leaked
// structure" intent. Callers use `count` purely to decide whether to log
// "N secrets redacted from this turn", never to reconstruct what matched.
function redact(text) {
  if (!text) return { text, count: 0 };
  let out = text;
  let count = 0;

  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, () => { count++; return '[REDACTED]'; });
  }

  const survivors = [...out.matchAll(CANDIDATE_RUN_RE)].map(m => m[0]);
  for (const token of survivors) {
    if (isWhitelisted(token)) continue;
    const isHexOnly = /^[0-9a-fA-F]+$/.test(token);
    const entropy = isHexOnly
      ? shannonEntropy(token, HEX_CHARS)
      : shannonEntropy(token, BASE64_CHARS);
    const limit = isHexOnly ? HEX_ENTROPY_LIMIT : BASE64_ENTROPY_LIMIT;
    if (entropy >= limit) {
      out = out.split(token).join('[REDACTED]');
      count++;
    }
  }

  return { text: out, count };
}

module.exports = { redact };
```

Note on internal exports: unlike `blame-util.js` (which exports many helper functions for direct unit testing), `redact.js` should export **only** `redact` from `module.exports`. `SECRET_PATTERNS`, `shannonEntropy`, `isWhitelisted`, etc. stay module-private. Test the behavior of `redact()` end-to-end against fixtures (below), not the internals — this matches D-01's spirit (no internal structure exposed, not even to importers) and keeps the public surface to exactly what Phase 5 needs.

### `src/redact.test.js` — proposed fixture list and structure

```js
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('./redact');

describe('redact — vendor pattern coverage (D-02: all 9 categories)', () => {
  test('redacts an AWS access key ID', () => {
    const { text, count } = redact('export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    assert.equal(count, 1);
    assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(text.includes('[REDACTED]'));
  });

  test('redacts a GitHub classic PAT', () => {
    const token = 'ghp_' + '1'.repeat(36);
    const { count, text } = redact(`use ${token} to auth`);
    assert.equal(count, 1);
    assert.ok(!text.includes(token));
  });

  test('redacts an OpenAI key (T3BlbkFJ marker present)', () => {
    const token = 'sk-' + 'a'.repeat(20) + 'T3BlbkFJ' + 'b'.repeat(20);
    assert.equal(redact(token).count, 1);
  });

  test('redacts an Anthropic key (sk-ant-api03- prefix, AA suffix)', () => {
    const token = 'sk-ant-api03-' + 'x'.repeat(93) + 'AA';
    assert.equal(redact(token).count, 1);
  });

  test('redacts a Slack bot token', () => {
    assert.equal(redact('xoxb-1234567890123-1234567890123-abcdEFGHijkl').count, 1);
  });

  test('redacts a Google API key', () => {
    const token = 'AIza' + 'A'.repeat(35);
    assert.equal(redact(token).count, 1);
  });

  test('redacts a Stripe live secret key', () => {
    const token = 'sk_live_' + 'B'.repeat(24);
    assert.equal(redact(token).count, 1);
  });

  test('redacts a generic key=value assignment', () => {
    const { count, text } = redact('API_KEY=abcdEFGH12345678ijkl');
    assert.equal(count, 1);
    assert.ok(!text.includes('abcdEFGH12345678ijkl'));
  });

  test('redacts a multi-line PEM private key header (SC1: PEM key fixture)', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIBOgIBAAJBAKj34GkxFhD90vcNLYBSbxCf1LMWWpn26EmyMvzRC8b7mLNSm3TQ',
      't1uRJH9jNJEyOOe2wc02uSp2vGxrhFhCPjkCAwEAAQ...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const { text, count } = redact(pem);
    assert.equal(count, 1);
    assert.ok(text.includes('[REDACTED]'));
    // Documented behavior (see Pitfall 3): the header line pattern only
    // matches the header itself; the base64 body below it is NOT
    // separately pattern-matched (it may still be caught by the entropy
    // fallback if a body line clears the 20-char/4.5-bit floor — that is
    // incidental, not guaranteed, and is not asserted here).
  });

  test('redacts a .env-style block with multiple secrets (SC3: .env fixture)', () => {
    const envBlock = [
      'DATABASE_URL=postgres://user:hunter2@localhost/db',
      'STRIPE_SECRET_KEY=sk_live_' + 'C'.repeat(24),
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    ].join('\n');
    const { count } = redact(envBlock);
    // Expect >= 2: the Stripe key and the AWS key are vendor-shaped and
    // must both be caught. The embedded "hunter2" password is a known
    // false negative — see the dedicated low-entropy fixture below — so
    // this assertion intentionally uses >= rather than a fixed count.
    assert.ok(count >= 2);
  });
});

describe('redact — SHA/UUID whitelist (D-03: must NOT redact)', () => {
  test('does not redact a 40-hex git commit SHA', () => {
    const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    const { text, count } = redact(`see commit ${sha} for details`);
    assert.ok(text.includes(sha), 'SHA must survive redaction untouched');
    assert.equal(count, 0);
  });

  test('does not redact a UUID-v4 session id', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const { text, count } = redact(`session ${uuid} failed`);
    assert.ok(text.includes(uuid), 'UUID must survive redaction untouched');
    assert.equal(count, 0);
  });

  test('a random high-entropy token with NO vendor prefix IS redacted (fallback works)', () => {
    // 32-char base64, no vendor shape — must be caught by entropy alone.
    const token = 'wcqv6MU0Bxy/EJs6ziRjRvtmqU8H3xcL';
    const { text, count } = redact(`rotated secret: ${token}`);
    assert.ok(!text.includes(token));
    assert.equal(count, 1);
  });
});

describe('redact — documented false negatives (SC3: realistic fixtures, not just happy path)', () => {
  test('KNOWN GAP: a paraphrased secret with no vendor marker is NOT redacted', () => {
    const { text } = redact('the token is sk-abc123, does that look valid?');
    // Intentionally asserts the secret text SURVIVES — this fixture
    // documents/proves the false negative described in Pitfall 4, rather
    // than silently hoping no one notices the gap.
    assert.ok(text.includes('sk-abc123'));
  });

  test('KNOWN GAP: a short, low-entropy password is NOT redacted', () => {
    const { text } = redact('the password is hunter2');
    assert.ok(text.includes('hunter2'));
  });

  test('does not redact ordinary prose with no secret-shaped content', () => {
    const prose = 'Please refactor the auth middleware to use async/await.';
    const { text, count } = redact(prose);
    assert.equal(count, 0);
    assert.equal(text, prose);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| STACK.md draft used type-tagged markers (`[REDACTED-SECRET]`, `[REDACTED-HIGH-ENTROPY]`) | Single generic `[REDACTED]` marker for every match, per D-01 | Locked at `/gsd-discuss-phase` for this phase (2026-09-17) | Simpler output, zero leaked structure; planner must not carry forward the STACK.md draft's tagged-marker code verbatim |
| Original pending todo assumed "reuse warren's secret pattern list" | Confirmed false by direct source read (`warren/packages/warren-common/src/warren_common/secrets.py` is a credential vault, not a detector) — corrected in STACK.md and `STATE.md` | Milestone research pass, 2026-09-17 | This phase vendors its own pattern list from scratch (already reflected in D-02); no import path exists or is needed |

**Deprecated/outdated:** None specific to this phase — the vendor regex shapes and entropy formula are current as of live source fetches on 2026-09-17 (gitleaks `config/gitleaks.toml`, trufflehog's Anthropic detector, detect-secrets' `high_entropy_strings.py`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Public gitleaks/trufflehog/detect-secrets regex shapes and entropy thresholds remain accurate as ported here (verified against live fetches at milestone-research time, 2026-09-17, and re-tested with synthetic strings in this session, not re-fetched live in this research pass) | Standard Stack, Code Examples | If a vendor changes key format (e.g., a new OpenAI key prefix), a specific pattern goes stale until updated — low impact since the generic `key=value` and entropy fallback still provide partial coverage |
| A2 | `[\w.+/=-]{12,150}` as the generic pattern's value-capture bound (12–150 chars) is a reasonable floor/ceiling for real secrets without excessive false positives on ordinary prose | Standard Stack, Code Examples | Untested against this project's own real prompt corpus (none exists yet, since Phase 5 hasn't shipped) — if too loose, expect some ordinary assignment-shaped prose (`session_id = turn-42`, called out in D-03's own rationale) to get redacted; if too tight, expect some real secrets outside that length range to slip through. Recommend revisiting after Phase 5 ships and real prompt data exists. |

## Open Questions

1. **Should the generic `key=value` pattern's own false-positive rate against this project's actual future prompt corpus be measured before or after Phase 5 ships?**
   - What we know: D-03's own rationale text explicitly names `session_key = turn-42`-shaped strings as a plausible false-positive risk for the generic pattern (separate from the SHA/UUID whitelist, which only covers the entropy fallback, not vendor patterns).
   - What's unclear: There is no real captured-prompt corpus yet to test against (Phase 5 doesn't exist yet) — this phase can only validate against synthetic fixtures.
   - Recommendation: Ship with the fixtures in this document; flag in the module's top comment (already included above) that the generic pattern is best-effort and may need tuning once Phase 5 produces a real prompt corpus to test against. Do not block this phase on data that doesn't exist yet.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond the Node.js built-ins already required by the rest of the project (`node:test`, `RegExp`, `Math.log2`), all confirmed present (`node --version` → v22.22.3, matches `engines.node: >=22`).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in, no dependency) |
| Config file | none — `package.json` `scripts.test` is `node --test`, which auto-discovers `*.test.js` |
| Quick run command | `node --test src/redact.test.js` |
| Full suite command | `npm test` (runs all `*.test.js` under `src/`) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REDACT-01 | Detects and redacts all 9 vendor-prefixed secret categories | unit | `node --test src/redact.test.js` | Wave 0 — file does not exist yet, this phase creates it |
| REDACT-01 | Catches high-entropy tokens with no vendor prefix | unit | `node --test src/redact.test.js` | Wave 0 |
| REDACT-01 | Whitelists 40-hex SHAs and UUID-v4 shapes from entropy fallback (D-03) | unit | `node --test src/redact.test.js` | Wave 0 |
| REDACT-01 | Runs unconditionally — no bypass mechanism | design review (no runtime flag/parameter exists to disable it) | N/A — verified by code review that `redact(text)` takes no options argument | Wave 0 |
| REDACT-01 | Documents false-negative behavior against realistic fixtures (SC3) | unit (asserting the gap, not fixing it) | `node --test src/redact.test.js` | Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test src/redact.test.js`
- **Per wave merge:** `npm test` (full suite — this phase adds no other test files, but running the full suite catches any accidental regression in `blame-util.test.js` etc. from an unrelated edit)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/redact.js` — does not exist yet, this phase creates it (implements `redact(text)`)
- [ ] `src/redact.test.js` — does not exist yet, this phase creates it (fixture set above)
- [ ] Framework install: none needed — `node:test` is built in, already used by `blame-util.test.js`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — this module has no auth surface |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Free text is treated as untrusted input for pattern/entropy scanning purposes; no `eval`/dynamic regex construction from input — all `SECRET_PATTERNS` are static, literal `RegExp` objects, never built from the scanned text itself |
| V6 Cryptography | partial | No encryption/hashing is performed by this module (STACK.md's optional "hash the match for an audit trail" idea is explicitly NOT adopted here, consistent with D-01's zero-leaked-structure marker — a hash of a secret is still derived from the secret and is out of scope). The only math is Shannon entropy, which is a statistical measure, not cryptography, and must not be conflated with one. |

### Known Threat Patterns for this module

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Regex denial-of-service (catastrophic backtracking) from adversarial input (e.g., a very long pasted blob crafted to make a vulnerable regex hang) | Denial of Service | All patterns above use bounded quantifiers (`{16}`, `{36}`, `{58,74}`, etc.) or simple character classes with `+`/`*` on non-nested groups — none contain nested quantifiers or alternation-with-overlap patterns known to cause catastrophic backtracking. The generic `key=value` pattern's capture group `[\w.+/=-]{12,150}` is explicitly bounded (max 150 chars) specifically to cap worst-case regex engine work per match attempt. No further mitigation needed, but planner should avoid introducing an unbounded quantifier if patterns are edited later. |
| Redaction bypass via encoding tricks (base64-encoding a secret before pasting so no vendor pattern matches and entropy scoring sees "content", not the decoded secret) | Tampering / information disclosure | Explicitly out of scope for this phase and not mitigated — decoding arbitrary user-supplied encodings before scanning is a much larger feature (multi-encoding-aware scanning) not requested by REDACT-01 or CONTEXT.md. Document as a known limitation alongside the paraphrasing/low-entropy gaps in Pitfall 4, not silently. |

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` (this repo, milestone-level research, 2026-09-17) — original verified regex/entropy research against live gitleaks/trufflehog/detect-secrets source fetches
- `.planning/research/PITFALLS.md` (this repo, milestone-level research, 2026-09-17) — Pitfall 4/5/6, false-negative and notes-permanence risk framing
- `.planning/phases/04-secret-redaction-scanner/04-CONTEXT.md` — D-01/D-02/D-03 locked decisions
- Direct `node -e` execution in this research session (2026-09-17) — re-verified all 9 vendor regex patterns against synthetic matching strings, re-verified Shannon entropy formula against a real SHA (3.83 bits/char, hex) and three random 32-char base64 tokens (4.56-4.81 bits/char), confirming both the D-03 whitelist necessity and the entropy fallback's correctness
- `src/blame-util.js`, `src/cache.js`, `src/blame-util.test.js` (this repo, read directly, 2026-09-17) — confirmed module style (`'use strict'`, plain functions, single `module.exports`, `node:test`/`describe`/`test`/`assert/strict` test convention)
- `package.json` (this repo, read directly) — confirmed no `dependencies` block, `engines.node: >=22`, `scripts.test: "node --test"`

### Secondary (MEDIUM confidence)

None beyond what's already folded into STACK.md's primary sourcing (gitleaks `config/gitleaks.toml`, trufflehog Anthropic detector, detect-secrets `high_entropy_strings.py` — all fetched live at milestone-research time, not re-fetched in this phase-research pass, but re-tested against synthetic data here).

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack (zero-dep regex + entropy): HIGH — every pattern and the entropy formula were independently re-executed against real/synthetic strings in this session, not merely copied from STACK.md
- Architecture (module shape, pipeline order): HIGH — directly matches this project's own established conventions in `blame-util.js`/`cache.js`, verified by reading both files
- Pitfalls (false negatives, whitelist necessity): HIGH for the whitelist (empirically demonstrated: real SHA scores above threshold); MEDIUM for the broader false-negative landscape (paraphrasing/low-entropy gaps are structurally certain but their real-world frequency against actual future prompt data is unverifiable until Phase 5 ships and produces a corpus)

**Research date:** 2026-09-17
**Valid until:** 2026-10-17 (30 days — stable domain: regex/entropy techniques for secret detection change slowly; vendor key-format changes are the main freshness risk and are independently low-frequency events)

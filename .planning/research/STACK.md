# Stack Research

**Domain:** Secret detection/redaction for CLI-captured LLM prompt/response text (zero-dependency Node.js constraint)
**Researched:** 2026-09-17
**Confidence:** MEDIUM-HIGH (regex patterns verified against current gitleaks/trufflehog source; entropy algorithm verified against detect-secrets source; one prior assumption in project docs corrected below)

## Important correction to project assumptions

`.planning/PROJECT.md` and the pending todo (`2026-09-06-secret-redaction-on-notes.md`) both say to "reuse warren's secret pattern list." I read `warren/packages/warren-common/src/warren_common/secrets.py` directly — **it does not exist as assumed.** That module (`SecretLoader`/`parse_secrets_env`) is a `secrets.env` credential *vault* (name=value pairs injected into sandboxes at runtime), not a secret-*detector*. It has no regex library for recognizing AWS/GitHub/OpenAI/Anthropic key shapes and no entropy check. There is nothing in warren to port.

**Implication:** git-turn needs its own small, self-contained pattern list. This is fine — it's ~40 lines of regex plus one entropy function, well within the zero-dependency constraint. Update the todo/roadmap language when Phase 4 is planned; don't block on trying to import from warren.

## Recommended Approach

### Core Technique: layered detection (pattern match first, entropy check second)

| Technique | Purpose | Why Recommended |
|-----------|---------|------------------|
| `node:crypto` (only for hashing/redaction, not entropy) | Optional: hash redacted match for audit trail without storing plaintext | Already zero-dep, built-in |
| Plain `RegExp` literals, no library | Match known secret *shapes* (AWS, GitHub, OpenAI, Anthropic, Slack, private-key blocks, generic `key=value` assignments) | This is exactly what gitleaks/trufflehog do — a curated regex list, no npm package needed |
| Hand-rolled Shannon entropy function (~10 lines, pure math) | Catch high-entropy tokens that don't match a known vendor shape (rotated keys, custom tokens, JWT-adjacent secrets) | detect-secrets' `HighEntropyString` plugin is pure math (`-Σ p_x·log2(p_x)`) — no dependency required, trivial to port to JS |

No npm package is needed or appropriate here. `gitleaks`/`trufflehog`/`detect-secrets` are themselves the *reference implementations* to copy patterns from, not runtime dependencies to install (they're Go/Python binaries anyway, irrelevant to a Node zero-dep constraint).

## Verified Regex Patterns (copy-pasteable)

Sourced by fetching the live gitleaks default ruleset (`gitleaks/gitleaks` `config/gitleaks.toml`) and trufflehog's Anthropic detector source on 2026-09-17. Each includes rationale for inclusion.

```js
// src/redact.js — pattern list. Order matters: specific vendor shapes first,
// generic key=value assignment last (it's the broadest/most false-positive-prone).

const SECRET_PATTERNS = [
  // AWS access key ID — fixed-prefix, fixed-length, uppercase+digit alphabet.
  // Included because AWS creds are the single most common accidental-leak
  // pattern in every major secret scanner's default ruleset, and the shape
  // is unambiguous (no natural-language collision).
  { name: 'aws-access-key-id', re: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g },

  // AWS secret access key has NO fixed prefix (40 random base64-ish chars) —
  // gitleaks does not ship a dedicated regex for it either; it relies on
  // entropy detection. We rely on the generic high-entropy check below
  // rather than inventing a pattern that would be indistinguishable from
  // any other 40-char base64 blob.

  // GitHub tokens — fixed prefixes per token type (`ghp_`=classic PAT,
  // `gho_`=OAuth, `ghu_`=user-to-server, `ghs_`=server-to-server,
  // `ghr_`=refresh). Fixed-length suffix keeps false positives near zero.
  { name: 'github-pat', re: /\bgh[pousr]_[0-9a-zA-Z]{36}\b/g },
  { name: 'github-pat-fine-grained', re: /\bgithub_pat_\w{82}\b/g },

  // OpenAI — the `T3BlbkFJ` mid-string marker is base64("OpenAI") and is
  // present in every legacy and project-scoped OpenAI key; extremely low
  // false-positive rate because that marker essentially never occurs by
  // chance in ordinary text.
  { name: 'openai-api-key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{58,74}T3BlbkFJ[A-Za-z0-9_-]{58,74}\b|\bsk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}\b/g },

  // Anthropic — fixed prefix (`sk-ant-api03-` or `sk-ant-admin01-`), fixed
  // 93-char body, fixed `AA` suffix (checksum-like padding in the base64
  // alphabet Anthropic uses). Directly relevant since git-turn's own
  // prompt-capture feature is aimed at Claude Code sessions — this is the
  // single most likely secret to appear in captured prompt/response text.
  { name: 'anthropic-api-key', re: /\bsk-ant-(?:admin01|api03)-[A-Za-z0-9_-]{93}AA\b/g },

  // Slack tokens — bot/user/app tokens all share the `xox?-` prefix family
  // with numeric workspace/user IDs; near-zero false positive rate.
  { name: 'slack-token', re: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[a-zA-Z0-9]+)?\b/g },

  // PEM-style private key blocks — catches SSH/TLS/PGP private keys pasted
  // into a prompt in full. This is a structural marker, not entropy-based,
  // so it's cheap and has zero false positives.
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },

  // Google API key — fixed `AIza` prefix, fixed 35-char body.
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },

  // Stripe secret/restricted keys — fixed prefix, low false-positive rate.
  { name: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g },

  // Generic `key/token/secret/password = <value>` assignment. Broadest net,
  // ports gitleaks' generic-api-key rule almost verbatim. This is what
  // catches secrets from vendors without a distinctive prefix (custom
  // internal tokens, less-common SaaS API keys, etc.) when they appear in
  // an obvious assignment context. Kept last/lowest-priority because it's
  // the most prone to matching non-secrets (e.g. "session_key = turn-42").
  {
    name: 'generic-assigned-secret',
    re: /(?:access|auth|api[-_]?key|credential|creds|secret|token|passw(?:or)?d)[\w.-]{0,20}\s*[:=]\s*['"`]?([\w.+/=-]{12,150})['"`]?/gi,
  },
];

module.exports = { SECRET_PATTERNS };
```

### Shannon entropy check (catches unstructured high-entropy tokens the patterns above miss)

Ported directly from `detect-secrets`' `HighEntropyString` plugin (Python) — the algorithm is pure math, no dependency to port:

```js
// src/entropy.js
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_=';
const HEX_CHARS = '0123456789abcdefABCDEF';

// detect-secrets' default thresholds — verified against upstream source
// (Yelp/detect-secrets, plugins/high_entropy_strings.py) on 2026-09-17.
const BASE64_ENTROPY_LIMIT = 4.5;
const HEX_ENTROPY_LIMIT = 3.0;

function shannonEntropy(str, charset) {
  if (!str) return 0;
  const counts = new Map();
  for (const ch of str) {
    if (!charset.includes(ch)) return 0; // not in this charset — not scored
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Scan free text for base64-like or hex-like runs of length >= 20 and flag
// any whose Shannon entropy exceeds the vendor threshold. 20 is
// detect-secrets' practical floor for avoiding short-word false positives
// (below ~20 chars, entropy math is too noisy to be reliable).
const CANDIDATE_RUN_RE = /[A-Za-z0-9+/_-]{20,}={0,3}/g;

function findHighEntropyTokens(text) {
  const hits = [];
  for (const match of text.matchAll(CANDIDATE_RUN_RE)) {
    const token = match[0];
    const isHexOnly = /^[0-9a-fA-F]+$/.test(token);
    const entropy = isHexOnly
      ? shannonEntropy(token, HEX_CHARS)
      : shannonEntropy(token, BASE64_CHARS);
    const limit = isHexOnly ? HEX_ENTROPY_LIMIT : BASE64_ENTROPY_LIMIT;
    if (entropy >= limit) {
      hits.push({ token, index: match.index, entropy });
    }
  }
  return hits;
}

module.exports = { shannonEntropy, findHighEntropyTokens, BASE64_ENTROPY_LIMIT, HEX_ENTROPY_LIMIT };
```

### Integration point — `redact(text)` called before `addNote()`

```js
// src/redact.js (continued)
const { SECRET_PATTERNS } = require('./redact'); // (same file, shown split above for clarity)
const { findHighEntropyTokens } = require('./entropy');

function redact(text) {
  if (!text) return text;
  let out = text;

  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED-SECRET]');
  }

  // Second pass: anything left that's still a high-entropy run (secrets
  // that didn't match a known vendor shape). Recompute on the
  // already-partially-redacted string so we don't re-flag the placeholder.
  for (const { token } of findHighEntropyTokens(out)) {
    out = out.split(token).join('[REDACTED-HIGH-ENTROPY]');
  }

  return out;
}

module.exports = { redact, SECRET_PATTERNS };
```

Call site in `src/hooks/post-commit.js` (`createCheckpoint()`), applied to every free-text field before it's serialized into the note payload — never to structural fields like `session_id`/`snapshot_sha`/`ts` which are git-turn-generated, not user/LLM-generated, and don't need scanning:

```js
const { redact } = require('../redact');

const notePayload = JSON.stringify({
  session_id: session.session_id,
  turn_n: turnN,
  snapshot_sha: commitSha,
  ts,
  // New in Phase 4 — only these three are free text and need redaction:
  prompt: prompt ? redact(prompt) : undefined,
  model: model, // structural, vendor/model name — not scanned
  latency_ms: latencyMs, // structural, numeric — not scanned
  usage: usage, // structural, token-count object — not scanned
});
addNote(NOTES_REF, head, notePayload);
```

This matches the existing `addNote(ref, commitSha, message)` signature in `src/git.js` (line 178) exactly — `redact()` is a pure string transform inserted immediately before `JSON.stringify`, no signature changes needed anywhere in the existing hook/git module chain.

**Never block the commit.** Consistent with the existing `pending.then(createCheckpoint).catch(...)` pattern in `post-commit.js` — redaction runs synchronously inside `createCheckpoint()`, and if it throws (it shouldn't; it's pure regex/math), the existing top-level `.catch` already logs to stderr and swallows the error rather than failing the commit.

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Any npm secret-scanning package (`secretlint`, `@secretlint/*`, gitleaks-node wrappers, etc.) | Violates the hard zero-npm-dependency constraint; `package.json` has no `dependencies` block by design | The regex + entropy code above, vendored directly into `src/` |
| ML/statistical classifiers (transformer-based secret detectors, entropy-scoring services) | Explicitly out of scope per the downstream consumer's instructions; also would require model weights/inference deps, incompatible with zero-dep | Regex-first, entropy-as-fallback — this is exactly what gitleaks/trufflehog/detect-secrets do in practice; ML detectors are a research direction those tools don't ship by default either |
| A generic "redact everything base64-looking" blanket rule with no length/entropy floor | Destroys legitimate prompt content (base64-encoded images, encoded diffs, etc. are common in agent prompts) — high false-positive cost | Length floor (20 chars) + entropy threshold (4.5 base64 / 3.0 hex), matching detect-secrets' tuned defaults |
| Trying to reuse "warren's secret pattern list" as instructed in existing project docs | Verified by reading `warren/packages/warren-common/src/warren_common/secrets.py` directly — it's a credential vault (`SecretLoader`), not a pattern-based detector; there is no pattern list to reuse | Vendor the pattern list above into git-turn directly; treat warren as unrelated to this feature |
| A separate `git turn redact <N>` retroactive command as the *primary* mitigation | The pending todo proposes this as one of two options — it addresses history-rewrite of already-leaked secrets but does nothing to prevent the leak in the first place, and `refs/notes` amend-in-place still leaves the original note object reachable via reflog/dangling-object GC windows | Prioritize the pre-write `redact()` gate (this document) as the primary control; keep the retroactive `redact <N>` command as a secondary defense-in-depth feature, not a substitute |

## Alternatives Considered

| Recommended | Alternative | When Alternative Makes Sense |
|-------------|-------------|-------------------------------|
| Hand-vendored regex list (above) | Shell out to a locally-installed `gitleaks`/`trufflehog` binary via `execFile` if present on `$PATH` | If git-turn later wants *comprehensive* coverage (hundreds of vendor rules) and is willing to make detection best-effort/optional depending on tool availability — but this reintroduces an external-binary dependency the project has avoided for git itself, and most environments won't have gitleaks installed, so it can't be the only line of defense |
| Shannon entropy on candidate substrings | Full n-gram/Markov-chain "randomness" scoring (what some detect-secrets plugins use as a refinement) | Only worth the added complexity if false-positive rates from plain Shannon entropy prove too high in practice; start simple, tune the threshold empirically against real captured prompts before reaching for anything fancier |
| Redact matched substring only, keep surrounding text | Redact/drop the entire prompt if any secret is found | Only if the product decision is "any leak risk voids the whole capture" — substring redaction preserves more of the prompt's diagnostic value (the whole point of Phase 4) while still removing the sensitive part |

## Version Compatibility

No package versions apply — this is vendored code using only `RegExp`, `String.prototype.matchAll`, and `Math.log2`, all available since Node.js 12+. git-turn's existing `node:sqlite` usage already implies a modern Node baseline (`node:sqlite` requires Node 22.5+ or 23.4+ stable), so no compatibility risk here.

## Sources

- `gitleaks/gitleaks` `config/gitleaks.toml` (fetched live, 2026-09-17) — AWS, GitHub, OpenAI, Anthropic, Slack, generic-api-key regex patterns. HIGH confidence (verified against current upstream source).
- `trufflesecurity/trufflehog` `pkg/detectors/anthropic/anthropic.go` (fetched live, 2026-09-17) — cross-checked Anthropic key regex against a second scanner; both sources agree on `sk-ant-{admin01|api03}-<93 chars>AA` shape. HIGH confidence.
- `Yelp/detect-secrets` `detect_secrets/plugins/high_entropy_strings.py` (fetched live, 2026-09-17) — Shannon entropy formula, default thresholds (base64 4.5, hex 3.0), charset definitions. HIGH confidence.
- `warren/packages/warren-common/src/warren_common/secrets.py` (read directly from local checkout, 2026-09-17) — confirmed it is a `secrets.env` credential vault, not a secret-pattern detector; corrects an incorrect assumption in `.planning/PROJECT.md` and the pending todo. HIGH confidence (primary source read directly).
- `src/git.js` / `src/hooks/post-commit.js` in this repo (read directly, 2026-09-17) — confirmed `addNote(ref, commitSha, message)` signature and existing serialize-then-write flow for the integration point. HIGH confidence.

---
*Stack research for: secret redaction in prompt-capture write path*
*Researched: 2026-09-17*

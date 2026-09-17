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
//
// KNOWN LIMITATIONS (accepted, see 04-RESEARCH.md Security Domain): a
// secret that has been base64/URL-encoded before being pasted into prompt
// or response text will not be decoded before scanning, so it will not be
// matched by the vendor-prefix patterns above (T-04-02). The encoded blob
// may still trip the entropy fallback incidentally, since encoded output
// is itself a high-entropy run — but that is not guaranteed and must not
// be relied upon. Multi-encoding-aware scanning (recursively decoding
// base64/URL/hex layers before matching) is deliberately out of scope for
// REDACT-01; this is a documented, accepted gap, not a silent one.

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

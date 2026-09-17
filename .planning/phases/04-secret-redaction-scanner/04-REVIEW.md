---
phase: 04-secret-redaction-scanner
reviewed: 2026-09-17T21:32:00+01:00
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/redact.js
  - src/redact.test.js
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-09-17T21:32:00+01:00
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

`src/redact.js` implements a layered secret scanner (vendor-prefix regex + Shannon-entropy fallback with a SHA/UUID whitelist). The bounded-quantifier regex design avoids catastrophic backtracking, the module correctly refuses to expose an opt-out surface, and `src/redact.test.js` proves several documented false negatives rather than hiding them — this is solid adversarial test discipline. No hardcoded secrets, `eval`, empty catch blocks, or debug artifacts were found.

No Critical/BLOCKER issues were found — no injection, no auth bypass, no real secret leakage was identified. The findings below are correctness/robustness gaps: an unguarded type assumption that can throw, a whitelist that a nearby adjacent character can defeat (over-redaction, not a leak), an over-broad generic pattern, and a coverage gap for non-40-hex object identifiers. None of these compromise the "no bypass" guarantee (REDACT-01) that the tests specifically verify.

## Warnings

### WR-01: `redact()` assumes `text` is always a string, no defensive type check

**File:** `src/redact.js:77-78`
**Issue:** `function redact(text) { if (!text) return { text, count: 0 }; let out = text; ... out.replace(...) }`. The falsy-input guard only protects against `null`/`undefined`/`''`/`0`/`false`. Any truthy non-string value (a number, an object, an array — e.g. a caller accidentally passing a parsed JSON object instead of stringified text) reaches `out.replace(re, ...)` on line 83 and throws `TypeError: out.replace is not a function`. Given the module's own docstring states this function is "Called before every note write; must never be bypassed," an uncaught exception here is worse than a silent pass-through — depending on how the (unseen) caller handles the exception, a thrown error could either abort the write (availability issue) or, if wrapped in a broad try/catch that swallows errors and falls back to writing the raw payload, silently bypass redaction entirely. This file doesn't show the caller, but the risk is real enough to warrant an explicit guard here rather than relying on every caller getting it right.
**Fix:**
```js
function redact(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text, count: 0 };
  }
  ...
}
```

### WR-02: SHA/UUID whitelist is defeated by an adjacent non-delimiter character, causing over-redaction of legitimate identifiers

**File:** `src/redact.js:48, 68-70, 86-98`
**Issue:** `CANDIDATE_RUN_RE` (`/[A-Za-z0-9+/_-]{20,}={0,3}/g`) has no upper bound and no boundary requirement distinguishing a 40-char SHA from a longer run. If a git SHA or UUID is directly abutted by another alphanumeric character with no delimiter (e.g. `commit-a94a8fe5ccb19ba61c4c0873d391e987982fbbd3x` or a filename like `a94a8fe5ccb19ba61c4c0873d391e987982fbbd3.patch` where `.patch` is broken by the dot, but `sha1a94a8fe5ccb19ba61c4c0873d391e987982fbbd3` is not), the candidate token captured is longer than exactly 40/36 chars. `isWhitelisted()` (line 68-70) uses `^...$`-anchored exact-length regexes, so this longer token fails the whitelist check and falls through to entropy scanning, where it will very likely be redacted (over-redaction of a legitimate, benign identifier). This is the "safe" direction of the false-positive/false-negative tradeoff (no secret is missed), but it means the whitelist's documented guarantee ("must NOT redact" — D-03, tested at `redact.test.js:103-116`) only holds when the SHA/UUID is delimiter-bounded, which is not stated in the docstring at `redact.js:1-29`.
**Fix:** Either document this precondition explicitly in the module comment, or tighten the whitelist check to also match a SHA/UUID found as a delimited substring within a longer candidate run (e.g. re-run `GIT_SHA_RE`/`UUID_V4_RE` with `\b` boundaries against the full `out` string before entropy-scanning it as a monolithic block), e.g.:
```js
// before treating the whole run as one candidate, strip any whitelisted
// SHA/UUID substrings bounded by \b from within it.
```

### WR-03: Generic `key=value` pattern can over-redact ordinary prose containing keyword+delimiter+long-token shapes

**File:** `src/redact.js:41`
**Issue:** `(?:access|auth|api[-_]?key|credential|creds|secret|token|passw(?:or)?d)[\w.-]{0,20}\s*[:=]\s*['"\`]?([\w.+/=-]{12,150})['"\`]?` is not anchored to a keyword boundary at the start (no `\b` before the alternation) and matches any occurrence of these six-to-nine-letter substrings followed eventually by `:`/`=` and 12+ word-ish characters. This is intentionally broad per the module's risk posture, but it also means ordinary developer discussion — e.g. `"the auth: middleware-refactor-2024-09-17-final"` or a commit message containing `"token: a1b2c3d4e5f6g7h8i9j0"` used as a build/CI identifier rather than a credential — will be silently redacted with no indication to the user of *why* (count is untyped by design, per the docstring at lines 72-76). This is consistent with the stated risk-reduction goal but is worth flagging as a real usability/quality tradeoff, since git-turn is a developer notes tool where words like "token", "auth", and "secret" appear routinely in non-secret contexts (build tokens, auth middleware, secret sauce/config naming).
**Fix:** No code change required if this is an accepted tradeoff (it appears to be, per D-01's stated intent), but the docstring should explicitly call out this specific false-positive class (keyword-adjacent non-secret prose) alongside the existing "KNOWN FALSE NEGATIVES" section, so downstream consumers aren't surprised by over-redaction of benign text.

### WR-04: Whitelist only covers 40-hex (SHA-1) identifiers; SHA-256 git object IDs and other common hex identifiers are not covered

**File:** `src/redact.js:50-51`
**Issue:** `GIT_SHA_RE = /^[0-9a-f]{40}$/i` only matches the legacy SHA-1 40-hex object ID format. Git repositories configured for the SHA-256 object format (`git init --object-format=sha256`, GA since Git 2.42) use 64-hex object IDs, which are not whitelisted and will be entropy-redacted as false positives in a tool explicitly named "git-turn" that is likely to surface git object IDs in notes. This is a narrower version of WR-02 but worth calling out separately since it's a coverage gap rather than an adjacency-defeat issue.
**Fix:** Add a 64-hex whitelist regex alongside `GIT_SHA_RE`, or generalize to `/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i`, if SHA-256 repos are in scope for this project.

## Info

### IN-01: No test coverage for non-string / null / undefined inputs to `redact()`

**File:** `src/redact.test.js`
**Issue:** The test suite covers empty string (`redact.test.js:148-150`) but does not test `redact(null)`, `redact(undefined)`, or a non-string truthy value (e.g. `redact(123)` or `redact({})`). Given WR-01 above, a regression test here would catch the TypeError case and pin down expected behavior (return-as-is vs. throw vs. coerce).
**Fix:**
```js
test('redact(null) does not throw and returns count 0', () => {
  assert.deepEqual(redact(null), { text: null, count: 0 });
});
test('redact(undefined) does not throw and returns count 0', () => {
  assert.deepEqual(redact(undefined), { text: undefined, count: 0 });
});
```

### IN-02: "No-bypass surface" test doesn't assert the returned text is also unaffected by the bogus options argument

**File:** `src/redact.test.js:169-177`
**Issue:** The test asserts `count` is unaffected by a spurious second `{ enabled: false }` argument (line 175-176) but doesn't also assert on `text` (e.g. `assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'))`), leaving a small gap in an otherwise security-critical test.
**Fix:**
```js
const { count, text } = redact('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', { enabled: false });
assert.equal(count, 1);
assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
```

---

_Reviewed: 2026-09-17T21:32:00+01:00_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

# Phase 4: Secret Redaction Scanner - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-17
**Phase:** 4-Secret Redaction Scanner
**Areas discussed:** Redaction marker format, Vendor pattern coverage, False-positive handling for git-turn's own identifiers

---

## Redaction marker format

| Option | Description | Selected |
|--------|-------------|----------|
| Generic tag: `[REDACTED]` | Simple, no info leaked about what type of secret was caught | ✓ |
| Typed tag: `[REDACTED-AWS-KEY]` | Shows which pattern matched — useful for debugging, slightly more informative to an attacker | |
| Partial reveal: `sk-...ab12` | Keeps first/last few chars for identification without exposing the full secret | |

**User's choice:** Generic tag: `[REDACTED]`
**Notes:** None.

---

## Vendor pattern coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Full suggested set | AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM, generic key=value | ✓ |
| Coding-agent-focused subset | OpenAI, Anthropic, GitHub, generic key=value, PEM only | |

**User's choice:** Full suggested set
**Notes:** None.

---

## False-positive handling for git-turn's own identifiers

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, whitelist known shapes | Exempt 40-hex SHAs and UUID-v4 shape from entropy detection specifically | ✓ |
| No, treat everything uniformly | Simpler scanner, accept some false positives on SHAs/UUIDs | |

**User's choice:** Yes, whitelist known shapes
**Notes:** None.

---

## Claude's Discretion

- Exact entropy thresholds (base64/hex bits-per-char, minimum run length) — left for research/planning to finalize against validation fixtures.
- Where documented false-negative behavior lives (README, AGENTS.md, or a dedicated doc) — planner's call.

## Deferred Ideas

None — discussion stayed within phase scope.

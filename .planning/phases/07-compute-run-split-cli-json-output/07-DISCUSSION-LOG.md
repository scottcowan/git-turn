# Phase 7: Compute/Run Split, Rich Diff Rendering & CLI JSON Output - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-07 / 2026-10-08
**Phase:** 7-Compute/Run Split, Rich Diff Rendering & CLI JSON Output
**Areas discussed:** Todo folding, Rich diff visual style, --json output shape, --plain flag scope, Error handling in --json mode

---

## Todo folding

| Option | Description | Selected |
|--------|-------------|----------|
| Rich diff renderer (score 0.9) | Touches diff.js/show.js, but changes output | ✓ (initially) |
| Stable change-identity (score 0.2) | Weak keyword match, research exploration | ✓ (initially) |
| Fold neither | Keep Phase 7 to REFACTOR-01 + JSON-01 | |

**Follow-up:** Flagged conflict — rich renderer changes output vs. REFACTOR-01's byte-identical bar; change-identity unrelated.
**User's choice:** "rich diff by default and --plain or something gives you the existing one"
**Notes:** Rich renderer folded as new requirement DIFF-01 (REQUIREMENTS.md + ROADMAP.md amended, commit 8cc93cf). Change-identity not folded.

---

## Rich diff visual style

| Option | Description | Selected |
|--------|-------------|----------|
| New-file line numbers only | One column, delta/diff-so-fancy default | ✓ |
| Both old and new line numbers | Two columns, more width | |

| Option | Description | Selected |
|--------|-------------|----------|
| Summary at top | Matches --stat convention | ✓ |
| Summary at bottom | Closing recap | |

---

## --json output shape

| Option | Description | Selected |
|--------|-------------|----------|
| Natural shape per command | Optimized per data type, docker/kubectl style | ✓ |
| Common {command, data} envelope | Uniform top-level shape | |

---

## --plain flag scope

| Option | Description | Selected |
|--------|-------------|----------|
| Only diff/show recognize --plain | No no-op flags on log/blame/cost | ✓ |
| All 5 accept as no-op | Consistent parsing | |

---

## Error handling in --json mode

| Option | Description | Selected |
|--------|-------------|----------|
| JSON error object on stdout, exit 1 | Always JSON.parse-able | ✓ |
| Keep plain-text stderr + exit 1 | --json only affects success path | |

---

## Claude's Discretion

- Per-command JSON field names/schemas
- Exact ANSI colors and gutter styling
- --json + --plain interaction
- Shared renderer module placement
- Hunk parsing approach (hand-parse vs. reuse blame-util's parser)
- cost.js stderr progress indicator placement under the split

## Deferred Ideas

- Stable change-identity todo stays in backlog (reviewed, not folded)

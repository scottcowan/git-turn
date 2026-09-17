# Phase 4: Secret Redaction Scanner - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning

<domain>
## Phase Boundary

A standalone content scanner (`src/redact.js`) that detects likely secrets in free-text content (prompts, responses, tool-summary text) and redacts each match, before any of that content can be written into a note. Must run unconditionally, with no bypass flag. This phase delivers the scanner module and its validation only — it is not yet wired into any note-write path (that's Phase 5's job).

</domain>

<decisions>
## Implementation Decisions

### Redaction marker format
- **D-01:** Use a generic marker: `[REDACTED]`. Do not tag the marker with the matched pattern type (rejected `[REDACTED-AWS-KEY]`-style tags) and do not partially reveal any characters of the matched secret (rejected `sk-...ab12`-style partial reveal). Simplicity and zero leaked structure win over debuggability here.

### Vendor pattern coverage
- **D-02:** Include the full suggested vendor-prefix set from research: AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM blocks, and generic `key=value` assignments. Don't narrow to a coding-agent-focused subset — breadth is cheap to include and gitleaks/trufflehog-style coverage is the reference standard.

### False-positive handling for git-turn's own identifiers
- **D-03:** The scanner MUST whitelist/exempt shapes that are known-benign in git-turn's own domain before running entropy detection: 40-character hex git SHAs and UUID-v4-shaped strings. These appear constantly in legitimate prompt text (commit references, session IDs) and would otherwise trigger frequent false-positive redactions under an entropy-based fallback. Vendor-prefix regex matches (AWS/GitHub/etc.) are unaffected by this whitelist — it only suppresses the generic entropy fallback for these specific known shapes.

### Claude's Discretion
- Exact entropy thresholds (base64 ~4.5 bits/char, hex ~3.0 bits/char per research) and minimum run-length tuning — left to research/planning to finalize against the validation fixtures, not a user-facing decision.
- Where documented false-negative behavior lives (README security section, AGENTS.md, or a dedicated doc) — planner's call.

### Folded Todos
- **`.planning/todos/pending/2026-09-06-secret-redaction-on-notes.md`** ("Add secret redaction for turn notes before they're written") — this todo is the original scoped rationale for this entire phase (already tagged `resolves_phase: 4`). Its Problem section (notes aren't cleaned by filter-repo, secrets stickier than commit messages) and Solution section (pre-write pattern scan) map directly onto this phase's goal. One correction from research that supersedes the todo's original text: "reuse warren's secret pattern list" is not viable — warren has no content/regex secret detector, only an encrypted credential store — so this phase builds its own vendored pattern list (per D-02) rather than importing one.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — storage model, key decisions, zero-npm-dependency constraint (hard constraint — no new packages for regex/entropy detection)
- `.planning/REQUIREMENTS.md` — REDACT-01 (this phase's only mapped requirement)
- `.planning/ROADMAP.md` §Phase 4 — goal, success criteria, dependency on Phase 03.1

### Research (this milestone)
- `.planning/research/STACK.md` — recommended zero-dependency approach: curated vendor-prefix regexes + hand-rolled Shannon-entropy fallback, patterns modeled on gitleaks/trufflehog/detect-secrets
- `.planning/research/PITFALLS.md` — Pitfall 4 (regex/entropy false-negative gaps on freeform conversational text) and Pitfall 5 (CI scanners don't cover `refs/notes/*`, so this scanner is often the only safety net) — both directly shape this phase's validation requirement (SC3 in ROADMAP.md: validate against realistic fixtures, not just vendor-pattern happy-path)
- `.planning/research/SUMMARY.md` — executive summary and roadmap rationale for why this phase must land and be validated before Phase 5 touches real content

### Prior-phase decisions (carried forward)
- `.planning/phases/03.1-turn-heatmap-calendar-grid-of-turn-activity-by-model-agent/03.1-CONTEXT.md` D-01 — heatmap's cost-coloring is explicitly deferred pending this phase (and Phase 5) landing real usage data; not directly actionable here but confirms this phase is a real dependency for other already-shipped features
- `AGENTS.md` — "all output is plain text on stdout, no `--json` flag" convention; if this phase's validation surfaces any CLI-visible output (unlikely — it's a library module), it must follow this convention

### Original todo (superseded assumption, corrected)
- `.planning/todos/pending/2026-09-06-secret-redaction-on-notes.md` — see Folded Todos above for the correction to its "reuse warren's pattern list" assumption

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None directly reusable — this is genuinely new code. `src/blame-util.js` and `src/cache.js` establish the project's module style (plain functions, named exports, no classes) that `src/redact.js` should match.

### Established Patterns
- Zero-npm-dependency discipline (`package.json` has no `dependencies` block) — `src/redact.js` must use only Node built-ins (`RegExp`, `String.prototype.matchAll`, `Math.log2` for entropy — all available on the project's `engines.node: >=22` floor)
- Test file convention: `src/redact.test.js` sibling to `src/redact.js`, using `node --test` (project's only test runner, no framework dependency)

### Integration Points
- None yet in this phase — `src/redact.js` should be built and tested standalone (e.g., `redact(text) -> { text: string, redactedCount: number }` or similar shape). Phase 5 wires it into `record-prompt`'s write path.

</code_context>

<specifics>
## Specific Ideas

No specific UI/output requirements — this is a non-interactive library module, not a CLI command. The main specific constraints are the three decisions above (generic marker, full vendor set, SHA/UUID whitelist).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Entropy threshold tuning and false-negative documentation location were explicitly left to research/planning discretion, not deferred to a future phase — see Claude's Discretion above.)

</deferred>

---

*Phase: 4-Secret Redaction Scanner*
*Context gathered: 2026-09-17*

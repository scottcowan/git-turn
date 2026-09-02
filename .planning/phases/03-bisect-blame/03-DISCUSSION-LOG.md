# Phase 3: bisect + blame - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 3-bisect-blame
**Areas discussed:** Blame granularity, Blame scope, Bisect worktree safety, Bisect reporting

---

## Blame granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-line (git-blame style) | Walk each turn's diff hunks to build a line→turn map. git-blame-style output. More work (hunk parsing, line-shift tracking). | ✓ |
| Per-file summary | List turns that touched the file, buildable today from `getTurnsForFile()`. Fast to ship, doesn't answer "which turn wrote line 42". | |

**User's choice:** Per-line (git-blame style)
**Notes:** Matches the roadmap success criterion ("which turn last touched each line") literally rather than settling for file-level granularity.

---

## Blame scope

| Option | Description | Selected |
|--------|-------------|----------|
| All sessions (full history) | Real git-blame semantics — most recent turn across all sessions, not just current. | ✓ |
| Current session only | Matches how `log`/`show`/`diff` scope today. Misses attribution from prior sessions. | |

**User's choice:** All sessions (full history)
**Notes:** Requires a new cross-session turn enumeration, since `readSession()` in `session.js` only scopes to the current session.

---

## Bisect worktree safety

| Option | Description | Selected |
|--------|-------------|----------|
| Require clean start + always restore | Like git bisect — refuse to start with uncommitted changes; always restore original state at the end regardless of outcome. | ✓ |
| Allow dirty start, best-effort restore | Proceed regardless of worktree state; still restore at the end but don't block on uncommitted changes. | |

**User's choice:** Require clean start + always restore
**Notes:** Mirrors `revert.js`'s existing pre-op-snapshot pattern.

---

## Bisect reporting

| Option | Description | Selected |
|--------|-------------|----------|
| Live progress (recommended) | Print each candidate turn and pass/fail as it's tested. | ✓ |
| Final answer only | Silent search, print only the final result. | |

**User's choice:** Live progress (recommended)
**Notes:** Mirrors `git bisect`'s running commentary.

---

## Claude's Discretion

- Exact line-shift tracking algorithm for per-line blame implementation
- Exact bisect search ordering and exit-code-to-good/bad mapping (defaulting to `git bisect run` convention: 0 = good, nonzero = bad) unless research finds a reason to deviate

## Deferred Ideas

None — discussion stayed within phase scope. Two pending todos were reviewed but not folded (see CONTEXT.md `<deferred>` — Reviewed Todos): the checkpoint/rewind-point terminology rename (unrelated to blame/bisect) and the SQLite read cache (already shipped in Phase 2, commit d591cff).

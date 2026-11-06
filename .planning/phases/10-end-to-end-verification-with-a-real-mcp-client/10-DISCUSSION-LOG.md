# Phase 10: End-to-End Verification with a Real MCP Client - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-06
**Phase:** 10-End-to-End Verification with a Real MCP Client
**Areas discussed:** Real client verification method, Target repo, Phase artifact

---

## Todo Fold (cross_reference_todos)

5 pending todos keyword-matched this phase on generic terms. User declined to even review the list in detail, confirming none fit a pure E2E-verification phase.

| Todo | Folded? |
|------|---------|
| `2026-11-01-git-turn-install-global-hook-via-init-templatedir.md` | Reviewed, not folded |
| `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` | Reviewed, not folded — stale, already shipped |
| `2026-09-17-mindwalk-integration.md` | Reviewed, not folded |
| `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` | Reviewed, not folded |
| `2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md` | Reviewed, not folded |

**User's choice:** "Leave all in backlog (Recommended)"

---

## Real client verification method

| Option | Description | Selected |
|--------|-------------|----------|
| Manual live check with this Claude Code session (Recommended) | The actual client named in ROADMAP, zero new dependencies | ✓ |
| Automated test using @modelcontextprotocol/sdk's client as a devDependency | Repeatable, but reintroduces the out-of-scope legacy package | |

**User's choice:** Manual live check with this Claude Code session (Recommended)
**Notes:** The installed `@modelcontextprotocol/server` has no client API; only the legacy SDK does.

---

## Target repo

| Option | Description | Selected |
|--------|-------------|----------|
| This git-turn project repo itself (Recommended) | Real history, no setup needed | ✓ |
| A disposable throwaway test repo | Cleaner/reproducible, matches VERIFY-03's pattern, but extra setup | |

**User's choice:** This git-turn project repo itself (Recommended)

---

## Phase artifact

| Option | Description | Selected |
|--------|-------------|----------|
| No new source files — manual checklist + VERIFICATION.md only (Recommended) | Nothing left to implement, pure verification | ✓ |
| Write a reusable manual test-procedure doc | Extra runbook for repeatability later | |

**User's choice:** No new source files — manual checklist + VERIFICATION.md only (Recommended)

---

## Claude's Discretion

- Exact phrasing/sequencing of the manual checklist steps.
- Whether the plan is a single tiny plan or zero plans with the checkpoint embedded directly.

## Deferred Ideas

None — discussion stayed within phase scope. Five pending todos were reviewed during cross-referencing and left in the backlog.

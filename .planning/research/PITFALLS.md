# Pitfalls Research

**Domain:** Adding prompt/response capture + secret redaction to a git-notes-based audit tool (git-turn v0.3)
**Researched:** 2026-09-17
**Confidence:** MEDIUM — git-notes mechanics (`-f`, `copy`, `notes.rewrite.*`) verified against `git-scm.com/docs/git-notes`; filter-repo/BFG notes-handling gap confirmed by absence in official docs (git-filter-repo manual and README contain zero mentions of `notes`/`refs/notes`); secret-scanner-coverage and race-condition claims are reasoned from the existing codebase (`src/git.js`, `src/hooks/post-commit.js`) and general git object-model behavior, not independently verified against a live filter-repo run — treat those as MEDIUM/LOW and validate empirically before shipping.

## Critical Pitfalls

### Pitfall 1: `addNote()` always passes `-f`, so `record-prompt` will silently clobber the hook's note (and vice versa)

**What goes wrong:**
`src/git.js` `addNote()` is hard-coded to `git notes add -f -m <message> <sha>` — force is unconditional. `post-commit.js` writes `{session_id, turn_n, snapshot_sha, ts}` on `HEAD` after every commit. When `record-prompt` is added, it will need to attach `prompt`/`model`/`latency_ms`/`usage` to that same commit's note. If `record-prompt` does a blind `addNote()` with just the new fields, it **replaces** the whole note body — `session_id`/`turn_n`/`snapshot_sha` are gone, and `log`/`show`/the SQLite cache lose the ability to associate that commit with its turn. If it instead does read-modify-write (get note → merge → `addNote -f`), two racing writers (the in-process post-commit hook and a separately-invoked `record-prompt` CLI process) can each read a stale copy and overwrite each other's update — classic lost-update race. There is no cross-process lock; `post-commit.js`'s `pending` promise chain only serializes writes *within one Node process*, not across the hook process and a `record-prompt` process.

**Why it happens:**
`-f` was added to make the hook idempotent against re-runs (e.g. `commit --amend` re-triggering post-commit), not to support a second writer merging fields into the same note. The existing code was written when only one writer (the hook) ever touched `refs/notes/git-turn`. Adding a second writer without revisiting the merge strategy is the natural way to break it.

**How to avoid:**
- Make note updates always read-modify-write through a single helper (`updateNote(ref, sha, patchFn)`) that does `getNote` → `JSON.parse` (defend against missing/corrupt note) → apply `patchFn` → `addNote -f`. Never let `record-prompt` write a raw object with only its own fields.
- Add an actual lock for the note-write critical section that works across processes, not just within one Node process — e.g. `git update-ref --create-reflog` semantics won't help here since `git notes add` already does its own ref-lock at the git level (see Pitfall 2), but the *read-modify-write* window around it is not protected by git. Options: retry-on-conflict (write, then re-read and diff to detect clobber, retry N times), or a lightweight lockfile in `.git/git-turn/` scoped to the specific commit sha being annotated.
- Treat `record-prompt` as expected to usually run well after the commit (post-commit hook has already finished), so design the retry/merge path for the rare-but-possible overlap rather than assuming it away.

**Warning signs:**
- `log --with-prompts` occasionally shows a turn with `session_id`/`turn_n` missing even though the turn ref exists.
- SQLite cache rebuild (`gc --rebuild`) surfaces notes that fail JSON parsing or are missing expected keys.
- Manual repro: fire a commit and immediately (same tick) run `record-prompt` in a tight loop — look for dropped fields.

**Phase to address:**
Note-write path / `record-prompt` implementation phase (before secret redaction is even in scope) — this is a correctness prerequisite for the whole feature, not an add-on.

---

### Pitfall 2: `git notes add` without `-f` aborts on an existing note — and the codebase's blanket `-f` hides *when* a collision happened

**What goes wrong:**
Per `git-notes(1)`: `git notes add` **aborts** if the target object already has a note, unless `-f`/`--force` is given (interactive `add` with no `-m` instead drops into edit mode on the existing note — different, also surprising, behavior). Since `addNote()` in `src/git.js` always passes `-f`, git-turn will never see this failure — it will silently succeed and overwrite. That's fine for idempotent hook re-runs, but it means the codebase currently has **no way to detect "a note already existed here"** — which is exactly the signal needed to decide whether `record-prompt` should merge into an existing hook-written note vs. create a fresh one. Losing that signal is what enables Pitfall 1.

**Why it happens:**
`-f` was chosen for simplicity/idempotency and nobody needed to distinguish "created" from "overwrote" until a second writer showed up.

**How to avoid:**
- Before writing, call `getNote()` first (already exists in `git.js`) to check for an existing note and branch: if present, merge fields in Node and write the merged JSON with `-f`; if absent, write fresh. This makes the "already exists" case explicit in application logic rather than relying on git's abort behavior (which `-f` bypasses anyway).
- Keep using `-f` at the git level (still needed for legitimate re-runs / amends) but never rely on git's own conflict signal — the merge decision belongs in `updateNote()`, not in git's exit code.

**Warning signs:**
- Any code path that calls `addNote()` with a payload assembled without first calling `getNote()`.

**Phase to address:**
Same note-write path phase as Pitfall 1 — implement `updateNote()` as the single write helper and audit all `addNote()` call sites to go through it.

---

### Pitfall 3: Treating history rewrite (filter-repo / BFG) as a way to remove a leaked secret from notes — it isn't, by default

**What goes wrong:**
If a secret does get written into `refs/notes/git-turn` (regex miss, or written before redaction runs — see Pitfall 5), the natural incident-response instinct is "rewrite history with `git filter-repo` or BFG Repo-Cleaner to scrub it," the same way teams handle a secret leaked in a commit message. That works for commits reachable from `refs/heads/*` and `refs/tags/*`, but **git notes live in their own ref (`refs/notes/git-turn`), which is itself a commit-history-shaped structure** (each note write is a new commit on that ref, per `notes.rewrite*` config semantics) that general-purpose history-rewriting tools do not process by default. Both the official `git-filter-repo` manual and its README (fetched directly) contain **zero mentions of `notes` or `refs/notes`** — it documents explicit handling for `refs/heads/*`, `refs/remotes/*`, tags, and `refs/replace/*`, but notes are conspicuously absent, meaning by default a leaked secret in a note **survives a filter-repo pass that the team believes cleaned their history**. BFG has the same class of gap (notes are not tree/blob content in the normal sense BFG's blob-stripping targets). This makes a secret leaked via `record-prompt` *stickier* than the same secret leaked in a commit message, precisely because the standard incident-response playbook doesn't cover it and nobody thinks to check.

**Why it happens:**
Notes are an unusual git feature most engineers (and most tooling) never interact with; rewrite tools are built and tested against the ref namespaces people actually rewrite (branches/tags). Notes fall outside that mental model entirely.

**How to avoid:**
- Document explicitly (README + a `record-prompt` help/warning) that `refs/notes/git-turn` is **not** cleaned by `git filter-repo`/BFG and requires manual remediation: delete/rewrite the note via `git notes remove` or `git notes add -f` with redacted content, **then** expire reflogs for that ref and run `git gc --prune=now` to actually drop the old blob — and even that only removes it locally; anyone who already fetched/pulled `refs/notes/git-turn` (if it's ever pushed — see Milestone context: currently local-only, but confirm this stays true) has a durable copy.
- Because prevention is far cheaper than remediation here, this pitfall is the strongest argument for redaction being mandatory and pre-write (not a best-effort scan users can disable) — which the milestone already locks in as a requirement. Keep it that way; do not add an opt-out flag.
- If/when `refs/notes/git-turn` is ever pushed to a remote (not in v0.3 scope per PROJECT.md, but likely later for team-shared audit trails), treat that as a much higher-severity version of this pitfall and gate it behind an explicit decision, not a default.

**Warning signs:**
- Any incident-response doc or runbook that says "run filter-repo to remove the leaked secret" without a separate step for notes refs.
- `git turn` has no documented command/procedure for purging a specific note's history.

**Phase to address:**
Secret redaction phase — the *documentation and remediation procedure* for "what if a secret gets through anyway" should ship alongside the redaction feature itself, not be an afterthought. Treat "redaction failed, now what" as an in-scope requirement, not an edge case.

---

### Pitfall 4: Deleting/overwriting a note does not delete the secret — old note blobs and note-tree commits remain reachable

**What goes wrong:**
`refs/notes/<ref>` is backed by a commit-tree structure of its own (git literally stores notes as a tree keyed by object sha, committed to the notes ref). `git notes remove` or a redacting `git notes add -f` only moves the ref to a **new** notes-tree commit — the prior notes-tree commit (and the blob containing the leaked secret) remains a loose/reachable object via the notes ref's own reflog and via any other ref/tag that might reference it, until `git gc` runs with reflog expiry. In practice this means "I redacted it" is **not true** the moment redaction runs — it's only true after a GC that most users never think to run, and even then only locally. This is a sharper version of the general "git never really deletes anything" problem, but it's worse here than for commits because notes-tree history is even less visible to users than commit history (`git log refs/notes/git-turn` is not something anyone runs routinely).

**Why it happens:**
Redaction naturally gets designed as "overwrite the bad content with a redacted version," which is correct for the *current view* (`git notes show`) but wrong for the *object store*, which is append-only until explicit GC.

**How to avoid:**
- Redact **before** the first write — never write raw prompt/response content to a note and redact afterward. This is the only approach that avoids ever creating the leaky object in the first place; everything else is remediation, not prevention.
- For defense-in-depth, provide a documented `gc`-integrated remediation path (git-turn already has a `gc` command per PROJECT.md) that, given a commit sha, expires the relevant reflog entries for `refs/notes/git-turn` and force-runs `git gc --prune=now` — so if a secret does slip through, there's a supported one-command way to actually purge it, not just instructions to run raw git plumbing.

**Warning signs:**
- Any redaction implementation that scans/redacts content and *then* calls `addNote()`, rather than redacting the string before it's ever passed to `addNote()`.
- No existing `git turn` command for reflog-expire + prune scoped to the notes ref.

**Phase to address:**
Secret redaction phase — redaction must sit directly in front of the write call (ideally inside `addNote`/`updateNote` itself, so no caller can bypass it), and the `gc` command should gain the purge capability in the same phase, not a later one.

---

### Pitfall 5: Regex/pattern-based detection (reused from warren) has real false-negative gaps against free-form prompt/response text

**What goes wrong:**
Warren's secret pattern list (per PROJECT.md, to be reused rather than reinvented) is very likely signature-based — recognizable prefixes/shapes like `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `sk_live_...`, generic `-----BEGIN PRIVATE KEY-----` blocks, etc. Those patterns were almost certainly designed against **structured contexts** (config files, `.env` diffs, commit content) where secrets appear as discrete tokens on their own line. Prompt/response capture is **unstructured conversational text** — a fundamentally different threat surface:
- A user pastes a stack trace, error log, or `.env` file contents into a prompt with no recognizable key prefix (e.g. a bare 40-character hex token, a database connection string, an internal hostname+credential pair).
- An LLM response paraphrases a secret in prose ("the password is `hunter2`" or "your API key `abc123...` looks malformed") — no fixed prefix, arbitrary surrounding text.
- Multi-line secrets (PEM private key blocks) get missed if the scanner processes the note payload line-by-line rather than as one contiguous blob, or if newlines get normalized/escaped in JSON encoding before the scan runs.
- Short, low-entropy secrets ("hunter2", a 6-digit PIN, an internal shared password) evade both pattern matching and entropy-based fallback detection, since entropy thresholds are tuned to avoid flagging normal English prose as a false positive.
This is a structurally higher false-negative risk than warren's original use case, because the input distribution changed (code/config → freeform chat) even though the pattern list didn't.

**Why it happens:**
"Reuse warren's pattern list" is the right call for consistency and to avoid inventing a second secret taxonomy, but it creates an implicit assumption that patterns tuned for one input distribution (structured files) transfer cleanly to another (conversational text) without re-validation.

**How to avoid:**
- Explicitly re-test warren's pattern list against representative prompt/response samples (real agent transcripts, not synthetic examples) before shipping, specifically for: pasted `.env`/config blocks, multi-line key material, paraphrased secrets in prose, and short/low-entropy credentials.
- Layer entropy-based detection as a supplement (not a replacement) to catch tokens that don't match known prefixes but look sufficiently random — accept some added false positives in exchange for narrowing the false-negative gap, and make the redaction placeholder clearly distinguishable so false positives are cheap to spot in review.
- Scan the whole payload as one blob (post-JSON-decode, pre-JSON-encode) rather than per-line, so multi-line secrets aren't split across scan boundaries.
- Document explicitly (in code comments and user-facing docs) that regex/entropy scanning is best-effort risk reduction, not a guarantee — this shapes expectations correctly and avoids treating "we redact secrets" as a security promise it can't keep.

**Warning signs:**
- Redaction test suite only covers warren's original pattern examples, not prompt/response-shaped inputs.
- No entropy-based fallback layer, or entropy thresholds copied verbatim from a config-file-scanning context without re-tuning.

**Phase to address:**
Secret redaction phase — pattern-list reuse should include an explicit validation step against realistic prompt/response fixtures, not just a direct import of warren's regex list.

---

### Pitfall 6: Standard secret scanners (CI/CD tooling, GitHub push protection, gitleaks/trufflehog) generally don't scan `refs/notes/*` by default

**What goes wrong:**
Even if git-turn's own redaction has gaps (Pitfall 5), teams often rely on a second line of defense: CI-run secret scanners or platform-level push protection. Most of these tools walk the default ref glob (branches, sometimes tags) because that's where commit *content* — their actual target — lives; notes are a niche feature most scanners were never built to traverse. If a secret slips past git-turn's own redaction into a note, it may go completely undetected by the safety net teams assume is watching everything, creating a false sense of security specifically because this feature's storage location (notes) is outside the blast radius those tools cover.

**Why it happens:**
Secret scanners are built and marketed against "your commits/PRs," and notes are rarely on anyone's radar — including the scanner vendors'.

**How to avoid:**
- Do not market or document git-turn's redaction as a complement to "your CI secret scanner will also catch it" — state plainly that notes are largely outside standard scanner coverage, so git-turn's own pre-write redaction is the primary (often only) safety net for this data path.
- If feasible, document a way for security-conscious teams to add `refs/notes/git-turn` to their own scanner's ref list (most scanners that support custom ref patterns can be pointed at it) as an optional hardening step, rather than assuming it happens automatically.

**Warning signs:**
- Redaction feature is documented/marketed as "defense in depth" implying other layers exist, when for this specific ref namespace they typically don't.

**Phase to address:**
Secret redaction phase — this is primarily a documentation/expectation-setting item, low implementation cost, but should ship with the feature so users don't develop a false sense of security.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Blind `addNote()` overwrite for `record-prompt` (no read-modify-write merge) | Fastest path to a working demo | Silently drops `session_id`/`turn_n`/`snapshot_sha`, breaking `log`/cache joins | Never — this breaks core forensic linkage, not just an edge case |
| Skip entropy-based fallback, ship pattern-only redaction | Less new code, faster ship | Higher false-negative rate on freeform prompt/response text (Pitfall 5) | Only as an explicit v0.3.0 limitation with a documented follow-up, never silently |
| Defer the notes-purge remediation command (Pitfall 4) to "later" | Smaller initial scope | No supported recovery path if redaction fails once in production | Acceptable only if redaction-before-write is airtight *and* documented as the sole safety net in the interim |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|--------------|-----------------|--------------------|
| `git notes add` | Assuming `-f` is "safe overwrite" with no side effects | Treat `-f` as "replace the visible note"; the prior blob still exists in the object store until GC — see Pitfall 4 |
| `git filter-repo` / BFG | Assuming a history-scrub also cleans notes because it cleaned the commit that triggered the incident | Notes require separate, manual remediation (reflog expire + gc scoped to `refs/notes/git-turn`) — see Pitfall 3 |
| warren's secret pattern list | Importing the regex list unchanged and assuming coverage transfers to prompt/response text | Re-validate against prompt/response-shaped fixtures; add entropy fallback — see Pitfall 5 |
| CI secret scanners (gitleaks/trufflehog/push protection) | Assuming they cover `refs/notes/*` the same as commit content | Document that they typically don't; redaction-before-write is the primary control — see Pitfall 6 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Read-modify-write on every `record-prompt` call re-reading and re-parsing the full note via `getNote`/`JSON.parse` | Negligible at current scale (one shell-out + small JSON per call) | Not a concern at git-turn's expected scale (per-turn, human-triggered) — flagging only so it isn't "fixed" by removing the read step, which would reintroduce Pitfall 1 | N/A at this project's scale |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|-------------|
| Writing raw prompt/response content to the note, then redacting in a follow-up write | Secret blob already exists in object store, recoverable via reflog until GC | Redact before the first `addNote()` call ever happens — see Pitfall 4 |
| Treating regex/entropy redaction as a guarantee rather than risk reduction | False confidence; users paste secrets assuming they're "safe" because git-turn "redacts secrets" | Document redaction as best-effort; validate against realistic fixtures — see Pitfall 5 |
| Allowing an opt-out flag for redaction (e.g. `--no-redact`) "for convenience" | Turns a mandatory safety control into an easily-disabled one, and the milestone explicitly locks redaction as non-optional | Do not add a bypass flag; if performance/UX friction is a concern, address it without an opt-out |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|--------------|-------------------|
| Silent redaction with no indication anything was removed | User can't tell whether their prompt was captured faithfully or partially redacted, undermining trust in the audit trail | Emit a clear, low-noise indicator (e.g. `[redacted: 2 matches]` inline or a summary line on `record-prompt` output) when redaction fires |
| `record-prompt` failing hard on a concurrent-write conflict with a raw git error | Confusing failure mid-session, may make users think the whole turn was lost | Retry transparently on lock/merge conflicts (Pitfall 1) a bounded number of times before surfacing a clear, actionable error |

## "Looks Done But Isn't" Checklist

- [ ] **`record-prompt` writes note fields:** Often missing the read-modify-write merge — verify existing `session_id`/`turn_n`/`snapshot_sha` survive a `record-prompt` call on a commit the hook already annotated.
- [ ] **Secret redaction:** Often tested only against warren's original config-file-style fixtures — verify against realistic prompt/response transcripts including multi-line and paraphrased secrets.
- [ ] **Redaction failure remediation:** Often undocumented — verify there's an actual supported command/procedure for purging a leaked-then-redacted note from the object store, not just "we redact on write."
- [ ] **Concurrent writer handling:** Often untested — verify behavior when `post-commit.js`'s hook and a `record-prompt` invocation race on the same commit sha (simulate with a tight-loop repro).
- [ ] **`--with-prompts` output:** Often assumes redaction placeholders round-trip cleanly through JSON — verify redacted content doesn't break note JSON parsing or corrupt other fields.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|-------------------|
| Note fields clobbered by a race (Pitfall 1) | LOW | Recompute the note from the SQLite cache / op log (which independently records `session_id`/`turn_n`/`snapshot_sha` per `writeOp` calls in `post-commit.js`) and rewrite the note with `addNote -f` |
| Secret leaked into a note before redaction is fixed (Pitfall 4/5) | HIGH | Redact the visible note immediately (`addNote -f` with a placeholder), then expire reflogs for `refs/notes/git-turn` and run `git gc --prune=now`; if the ref was ever pushed, treat as a full secret-rotation incident, not a git-cleanup task |
| Filter-repo/BFG run assumed to have cleaned notes but didn't (Pitfall 3) | HIGH | Re-run the manual notes-specific purge procedure (Pitfall 4) after the fact — the filter-repo pass provides no coverage here and must not be trusted as a checkbox |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Note clobbering / lost-update race (Pitfall 1) | Note-write path / `record-prompt` implementation phase | Concurrency repro test: fire hook + `record-prompt` on same sha in a tight loop, assert all fields present afterward |
| Missing "existing note" signal due to blanket `-f` (Pitfall 2) | Same note-write path phase | Unit test: `updateNote()` merges into an existing hook-written note rather than replacing it |
| History-rewrite tools don't cover notes (Pitfall 3) | Secret redaction phase (docs + remediation procedure) | Manual test: run `git filter-repo` against a repo with a note containing a marker string, confirm it survives — document this explicitly |
| Deleted/overwritten notes leave old blobs recoverable (Pitfall 4) | Secret redaction phase (redact-before-write + `gc` purge capability) | Object-store test: write raw secret, redact, `git gc --prune=now` with reflog expiry, confirm blob is unreachable |
| Regex/pattern false negatives on freeform text (Pitfall 5) | Secret redaction phase (fixture validation + entropy fallback) | Test suite with realistic prompt/response fixtures (pasted `.env`, multi-line PEM, paraphrased secrets, low-entropy passwords) |
| False sense of security from CI scanners not covering notes (Pitfall 6) | Secret redaction phase (documentation) | Docs review: redaction feature description explicitly states notes are outside typical scanner coverage |

## Sources

- `git-scm.com/docs/git-notes` (fetched directly) — HIGH confidence: `git notes add` aborts without `-f` on existing note; `-f`/`copy -f` overwrite semantics; `notes.rewrite.<command>`, `notes.rewriteRef`, `notes.rewriteMode` (concatenate/overwrite/cat_sort_uniq/ignore) config for automatic note-copying during amend/rebase.
- `git-filter-repo` README (github.com/newren/git-filter-repo, fetched directly) and its `Documentation/git-filter-repo.txt` manual (fetched directly) — MEDIUM confidence (absence-based): neither document mentions `notes` or `refs/notes` anywhere, despite explicitly documenting handling for `refs/heads/*`, `refs/remotes/*`, tags, and `refs/replace/*` — strong signal that notes are not part of filter-repo's default rewrite scope, but not independently confirmed by running filter-repo against a live repo with notes.
- `src/git.js`, `src/hooks/post-commit.js` (this repo) — HIGH confidence for current behavior: `addNote()` is unconditionally `-f`; hook serialization is in-process only (`pending` promise chain), not cross-process; note payload today is a flat JSON object with no merge logic.
- `.planning/PROJECT.md` — HIGH confidence for scope: redaction is a locked requirement for v0.3, reusing warren's pattern list, notes are local-only (no push scope) as of this milestone.
- General git object-model behavior (notes-tree-as-commit-history, loose objects surviving ref updates until reflog expiry + gc) — LOW/MEDIUM confidence, training-data-based; not independently re-verified with a live repro in this research pass — recommend the object-store test in the Pitfall-to-Phase Mapping table above before relying on it for the redaction-remediation design.
- BFG Repo-Cleaner notes-handling gap — LOW confidence, training-data-based only; no official BFG documentation was fetched in this research pass (not queried), included by analogy to filter-repo's confirmed gap since BFG operates on blob content, not notes-tree structure — flag for validation if BFG is specifically recommended in remediation docs.

---
*Pitfalls research for: git-turn v0.3 (Prompt Capture + Secret Redaction)*
*Researched: 2026-09-17*

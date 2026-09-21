'use strict';

// All git operations go through these helpers.
// Never use shell string interpolation — always pass args as an array.

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Whether diff output should carry ANSI color. Respects NO_COLOR (spec:
// no-color.org) and FORCE_COLOR overrides before falling back to TTY
// detection — piping to a file or another program gets plain text.
function shouldColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.stdio ? { stdio: opts.stdio } : {}),
  }).trim();
}

function gitSafe(args, opts = {}) {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']);
}

function gitDir() {
  return git(['rev-parse', '--git-dir']);
}

// Resolve the directory git will actually read hooks from. Respects
// core.hooksPath (e.g. Husky, lefthook) instead of assuming the default
// <common-dir>/hooks — a hook installed at the default location is silently
// never invoked when core.hooksPath points elsewhere.
function hooksDir() {
  const hooksPathCfg = gitSafe(['config', '--get', 'core.hooksPath']);
  if (hooksPathCfg) {
    if (path.isAbsolute(hooksPathCfg)) return hooksPathCfg;
    const top = gitSafe(['rev-parse', '--show-toplevel']) || process.cwd();
    return path.resolve(top, hooksPathCfg);
  }
  // In a git worktree, gitDir() returns .bare/worktrees/<name> which has no hooks/.
  // The shared hooks live in the common dir (the bare repo root).
  const common = gitSafe(['rev-parse', '--git-common-dir']) || gitDir();
  return path.join(common, 'hooks');
}

function headSha() {
  return gitSafe(['rev-parse', 'HEAD']) || '0'.repeat(40);
}

function currentBranch() {
  return gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
}

// Write a ref pointing at sha. Creates or updates.
function updateRef(ref, sha) {
  git(['update-ref', ref, sha]);
}

// Delete a ref.
function deleteRef(ref) {
  git(['update-ref', '-d', ref]);
}

// List all refs under a prefix.
function listRefs(prefix) {
  const out = gitSafe(['for-each-ref', '--format=%(refname) %(objectname)', prefix]);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const [ref, sha] = line.split(' ');
    return { ref, sha };
  });
}

// Create a dangling commit capturing the current worktree state.
// Returns the commit sha.
function snapshotWorktree({ message, env } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-turn-'));
  const tmpIndex = path.join(tmpDir, 'index');

  try {
    const root = repoRoot();

    // Build worktree tree in temp index (includes untracked)
    // Batched in groups of 100 to avoid ARG_MAX
    const untracked = gitSafe(['ls-files', '--others', '--exclude-standard'], { cwd: root });
    const untrackedFiles = untracked ? untracked.split('\n').filter(Boolean) : [];

    const tmpEnv = { GIT_INDEX_FILE: tmpIndex };

    // Seed temp index from HEAD (if exists)
    const head = headSha();
    if (head !== '0'.repeat(40)) {
      git(['read-tree', head], { env: tmpEnv });
    }

    // Add untracked in batches of 100
    for (let i = 0; i < untrackedFiles.length; i += 100) {
      const batch = untrackedFiles.slice(i, i + 100);
      // Skip large files > 10MB
      const smallBatch = batch.filter(f => {
        try { return fs.statSync(path.join(root, f)).size < 10 * 1024 * 1024; } catch { return false; }
      });
      if (smallBatch.length) {
        git(['add', '--', ...smallBatch], { env: tmpEnv, cwd: root });
      }
    }

    // Also capture staged changes (tracked files modified in worktree)
    git(['add', '-u'], { env: tmpEnv, cwd: root });

    // Capture staged-but-not-HEAD new files (added via `git add newfile` but not yet committed)
    const stagedNew = gitSafe(['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: root });
    const stagedNewFiles = stagedNew ? stagedNew.split('\n').filter(Boolean) : [];
    if (stagedNewFiles.length) {
      git(['add', '--', ...stagedNewFiles], { env: tmpEnv, cwd: root });
    }

    const worktreeTree = git(['write-tree'], { env: tmpEnv });

    // Real index tree (for reference; stored in return value only)
    const indexTree = gitSafe(['write-tree']) || worktreeTree;

    // Parent commit: use HEAD if it exists (headSha returns 40 zeros when no commits yet)
    const parentSha = headSha();
    const commitArgs = parentSha !== '0'.repeat(40)
      ? ['commit-tree', worktreeTree, '-p', parentSha, '-m', message || 'git-turn snapshot']
      : ['commit-tree', worktreeTree, '-m', message || 'git-turn snapshot'];

    const commitSha = git(
      commitArgs,
      { env: { GIT_AUTHOR_NAME: 'git-turn', GIT_AUTHOR_EMAIL: '', ...env } }
    );

    return { commitSha, worktreeTree, indexTree, untrackedFiles };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Restore worktree to a snapshot commit's worktree-tree
function restoreSnapshot(snapshotSha, { branch } = {}) {
  const currentBr = currentBranch();
  if (branch && branch !== currentBr) {
    throw new Error(`Branch mismatch: snapshot is from '${branch}', current branch is '${currentBr}'`);
  }
  const tree = git(['rev-parse', `${snapshotSha}^{tree}`]);
  git(['read-tree', '--reset', '-u', tree]);
}

// Write arbitrary content as a blob object. Returns the blob sha.
function writeBlob(content) {
  return git(['hash-object', '-w', '--stdin'], { input: content });
}

// Read a blob object's content by sha. Returns null if it doesn't exist.
function readBlob(sha) {
  return gitSafe(['cat-file', 'blob', sha]);
}

// Write a git note on a commit
function addNote(ref, commitSha, message) {
  git(['notes', `--ref=${ref}`, 'add', '-f', '-m', message, commitSha]);
}

// Read a git note
function getNote(ref, commitSha) {
  return gitSafe(['notes', `--ref=${ref}`, 'show', commitSha]);
}

// Read-merge-write a git note. patchFn must be pure and side-effect-free
// because it may run more than once on retry. The retry detects a
// content-level clobber (git notes add -f never reports a conflict) by
// re-reading the note immediately before writing; a residual sub-millisecond
// TOCTOU gap between that re-read and the write is deliberately accepted per
// 05-RESEARCH.md rather than adding a lock file.
function updateNote(ref, commitSha, patchFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const before = getNote(ref, commitSha);
    let existing = {};
    if (before) {
      try { existing = JSON.parse(before); } catch { existing = {}; }
    }
    const patched = patchFn(existing);
    const patchedJSON = JSON.stringify(patched);

    const justBeforeWrite = getNote(ref, commitSha);
    if (justBeforeWrite !== before) {
      if (attempt === maxRetries) {
        throw new Error(`updateNote: note for ${commitSha} changed concurrently, giving up after ${maxRetries} retries`);
      }
      continue;
    }
    addNote(ref, commitSha, patchedJSON);
    return patched;
  }
}

// Collapse a notes ref's entire commit history to a single parentless
// commit holding its CURRENT tree, then expire its reflog and force a
// full-repo gc. This is the only way to actually remove an old note blob
// from the object store — overwriting a note (addNote -f) or even
// expiring the ref's reflog alone leaves the prior notes-commit reachable
// as an ordinary ancestor of the current tip (verified empirically,
// 06-RESEARCH.md Focus Question 7 — this is NOT the same failure mode
// reflog-expiry protects against).
//
// WARNING: `git gc --prune=now` operates on the WHOLE repository, not
// just this ref. Any other unreachable object in the repo (e.g. a
// dangling commit from `git stash` or another tool, with no ref/reflog
// protecting it) is also permanently deleted by this call. This is
// unavoidable — git has no way to scope object pruning to one ref's
// history — and must be documented prominently in --help/README, not
// just here.
function purgeNotesHistory(ref) {
  const currentSha = gitSafe(['rev-parse', ref]);
  if (!currentSha) {
    return { purged: false, reason: `ref ${ref} does not exist` };
  }

  const tree = git(['rev-parse', `${ref}^{tree}`]);
  let newCommit;
  try {
    newCommit = git(
      ['commit-tree', tree, '-m', 'git-turn: purge notes history'],
      { env: { GIT_AUTHOR_NAME: 'git-turn', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'git-turn', GIT_COMMITTER_EMAIL: '' } }
    );
  } catch {
    // Fallback per 06-RESEARCH.md Assumption A2: some platforms may reject
    // empty author/committer emails on commit-tree. Fall back to relying on
    // repo git config user.name/user.email, which git-turn already requires.
    newCommit = git(['commit-tree', tree, '-m', 'git-turn: purge notes history']);
  }
  updateRef(ref, newCommit);

  // Missing reflog is expected and non-fatal (e.g. core.logAllRefUpdates=false) —
  // step above already severed the ancestor chain, which is the load-bearing part.
  gitSafe(['reflog', 'expire', '--expire=now', ref]);

  git(['gc', '--prune=now']);

  return { purged: true, oldSha: currentSha, newSha: newCommit };
}

module.exports = {
  git, gitSafe, repoRoot, gitDir, hooksDir, headSha, currentBranch, shouldColor,
  updateRef, deleteRef, listRefs,
  snapshotWorktree, restoreSnapshot,
  writeBlob, readBlob,
  addNote, getNote, updateNote, purgeNotesHistory,
};

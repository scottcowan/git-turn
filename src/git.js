'use strict';

// All git operations go through these helpers.
// Never use shell string interpolation — always pass args as an array.

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
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

// Write a git note on a commit
function addNote(ref, commitSha, message) {
  git(['notes', `--ref=${ref}`, 'add', '-f', '-m', message, commitSha]);
}

// Read a git note
function getNote(ref, commitSha) {
  return gitSafe(['notes', `--ref=${ref}`, 'show', commitSha]);
}

module.exports = {
  git, gitSafe, repoRoot, gitDir, headSha, currentBranch,
  updateRef, deleteRef, listRefs,
  snapshotWorktree, restoreSnapshot,
  addNote, getNote,
};

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { gitDir, gitSafe, git } = require('../git');
const { newSession, ensureDirs } = require('../session');

// Absolute path to post-commit.js, resolved at install time so the hook
// works in any repo regardless of whether git-turn is in its node_modules.
const HOOK_SCRIPT = () => {
  const hookSrc = path.resolve(__dirname, '../hooks/post-commit.js');
  return `#!/usr/bin/env node
// git-turn post-commit hook
// Installed by: git turn init
require(${JSON.stringify(hookSrc)}).run();
`;
};

function hooksDir() {
  const gd = gitDir();
  // In a git worktree, gitDir() returns .bare/worktrees/<name> which has no hooks/.
  // The shared hooks live in the common dir (the bare repo root).
  // git rev-parse --git-common-dir always returns the canonical hooks location.
  const common = gitSafe(['rev-parse', '--git-common-dir']) || gd;
  return path.join(common, 'hooks');
}

function run(args) {
  const hDir = hooksDir();
  const hookPath = path.join(hDir, 'post-commit');

  // Install hook
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes('git-turn')) {
      console.log('git turn: hook already installed');
    } else {
      console.error('git turn: post-commit hook already exists (not from git-turn)');
      console.error(`Edit ${hookPath} to add: require('git-turn/src/hooks/post-commit').run();`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(hDir, { recursive: true });
    fs.writeFileSync(hookPath, HOOK_SCRIPT(), { mode: 0o755 });
    console.log(`✓ Installed post-commit hook: ${hookPath}`);
  }

  // Set notes.expiry=never
  git(['config', 'notes.expiry', 'never']);
  console.log('✓ Set notes.expiry=never');

  // Set up log decoration
  git(['config', 'log.showSignature', 'false']);

  // Create session
  ensureDirs();
  const session = newSession();
  console.log(`✓ Started session: ${session.session_id}`);
  console.log(`✓ Captured ${session.preexisting_untracked.length} pre-existing untracked files`);

  // Write format discovery blob (D-11)
  const schema = JSON.stringify({
    version: '1',
    tool: 'git-turn',
    schema: 'turns/v1',
    ref_pattern: 'refs/git-turn/sessions/{id}/turn-{N}',
    notes_ref: 'refs/notes/git-turn',
  });
  const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    input: schema,
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  if (result.status === 0) {
    const blobSha = result.stdout.trim();
    git(['update-ref', 'refs/git-turn/format', blobSha]);
    console.log('✓ Wrote format discovery blob: refs/git-turn/format');
  } else {
    console.error('git turn: warning: failed to write format discovery blob:', (result.stderr || '').trim());
  }

  console.log('\ngit turn is ready. Run `git turn log` after your next agent session.');
}

module.exports = { run };

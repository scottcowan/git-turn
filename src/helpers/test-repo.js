'use strict';

const { mkdtempSync, rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * Create a temporary isolated git repo for tests.
 * HOME is overridden to dir to prevent ~/.gitconfig bleed (gpg signing, etc.)
 *
 * Returns { dir, git } where git(args, opts={}) runs git in the temp repo.
 * Callers clean up with: rmSync(dir, { recursive: true, force: true })
 */
function makeTestRepo() {
  const dir = mkdtempSync(join(os.tmpdir(), 'git-turn-test-'));

  function git(args, opts = {}) {
    return execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: dir },
      ...opts,
    }).trim();
  }

  git(['init', '-q']);
  git(['config', 'user.email', 'test@test.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), '# test\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);

  return { dir, git };
}

module.exports = { makeTestRepo };

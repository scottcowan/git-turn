'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

const { run } = require('./init');
const { git, gitSafe } = require('../git');

describe('init command', () => {
  let dir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('init writes format blob to refs/git-turn/format', () => {
    run([]);

    const blobContent = gitSafe(['cat-file', 'blob', 'refs/git-turn/format']);
    assert.ok(blobContent !== null, 'refs/git-turn/format should exist after init');

    const parsed = JSON.parse(blobContent);
    assert.equal(parsed.version, '1', 'blob JSON should have version === "1"');
    assert.equal(parsed.tool, 'git-turn', 'blob JSON should have tool === "git-turn"');
  });

  test('init does not write refs/turns/.format', () => {
    run([]);

    const invalidRef = gitSafe(['rev-parse', 'refs/turns/.format']);
    assert.equal(invalidRef, null, 'refs/turns/.format must not exist (invalid ref per Pitfall 1)');
  });

  test('init creates session.json', () => {
    run([]);

    const sessionPath = join(dir, '.git', 'git-turn', 'session.json');
    assert.ok(existsSync(sessionPath), 'session.json should exist after init');
  });

  test('init is idempotent when hook already installed', () => {
    run([]);
    // Second call should not throw (already-installed path prints a message, not an error exit)
    assert.doesNotThrow(() => run([]));
  });

  test('init installs into core.hooksPath when set (e.g. Husky), not the default hooks dir', () => {
    git(['config', 'core.hooksPath', '.husky']);
    mkdirSync(join(dir, '.husky'), { recursive: true });

    run([]);

    const husky = join(dir, '.husky', 'post-commit');
    assert.ok(existsSync(husky), 'hook should be installed at the core.hooksPath location');
    assert.ok(readFileSync(husky, 'utf8').includes('git-turn'));

    const defaultPath = join(dir, '.git', 'hooks', 'post-commit');
    assert.ok(!existsSync(defaultPath), 'default hooks dir should be untouched when core.hooksPath is set');
  });

  test('init appends to an existing foreign hook at core.hooksPath instead of overwriting it', () => {
    git(['config', 'core.hooksPath', '.husky']);
    mkdirSync(join(dir, '.husky'), { recursive: true });
    const husky = join(dir, '.husky', 'post-commit');
    writeFileSync(husky, '#!/usr/bin/env sh\necho "husky ran"\n');

    run([]);

    const content = readFileSync(husky, 'utf8');
    assert.ok(content.includes('husky ran'), 'existing hook content must be preserved');
    assert.ok(content.includes('git-turn'), 'git-turn call must be appended');
  });

  test('init is idempotent when appended to a foreign hook at core.hooksPath', () => {
    git(['config', 'core.hooksPath', '.husky']);
    mkdirSync(join(dir, '.husky'), { recursive: true });
    writeFileSync(join(dir, '.husky', 'post-commit'), '#!/usr/bin/env sh\necho "husky ran"\n');

    run([]);
    assert.doesNotThrow(() => run([]));

    const content = readFileSync(join(dir, '.husky', 'post-commit'), 'utf8');
    // Count the append marker, not bare "git-turn" — the resolved hook script's
    // absolute path can itself contain "git-turn" (e.g. this repo's own checkout
    // dir), which would inflate a substring count unrelated to append idempotency.
    const occurrences = content.split('appended by: git turn init').length - 1;
    assert.equal(occurrences, 1, 'git-turn call should be appended only once across repeated init runs');
  });
});

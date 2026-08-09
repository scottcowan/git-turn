'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

const { run } = require('./init');
const { gitSafe } = require('../git');

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
});

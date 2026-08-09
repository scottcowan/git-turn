'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

describe('status command', () => {
  let dir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    // Initialize git-turn session
    const { ensureDirs, newSession } = require('../session');
    ensureDirs();
    newSession();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Capture console.log output from run([]).
   */
  function captureStatus() {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      require('./status').run([]);
    } finally {
      console.log = origLog;
    }
    return logs.join('\n');
  }

  test('prints session ID, branch, turns, started, hook status', () => {
    const { readSession } = require('../session');
    const session = readSession();
    const output = captureStatus();

    assert.ok(output.includes(session.session_id), 'output should include session_id');
    assert.ok(output.includes('Branch:'), 'output should include Branch:');
    assert.ok(output.includes('Turns:'), 'output should include Turns:');
    assert.ok(output.includes('Started:'), 'output should include Started:');
    assert.ok(output.includes('Hook:'), 'output should include Hook:');
  });

  test('hook shows installed when hook file contains git-turn', () => {
    const hookDir = join(dir, '.git', 'hooks');
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, 'post-commit'), '#!/bin/sh\n# git-turn\n');

    const output = captureStatus();
    assert.ok(output.includes('installed'), 'hook status should be installed');
  });

  test('hook shows missing when hook file is absent', () => {
    // Ensure hook does not exist (makeTestRepo doesn't install it)
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    try { rmSync(hookPath); } catch { /* ignore if already absent */ }

    const output = captureStatus();
    assert.ok(output.includes('missing'), 'hook status should be missing');
  });

  test('hook shows not from git-turn when hook exists but lacks git-turn', () => {
    const hookDir = join(dir, '.git', 'hooks');
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, 'post-commit'), '#!/bin/sh\necho hello\n');

    const output = captureStatus();
    assert.ok(output.includes('not from git-turn'), 'hook status should be not from git-turn');
  });
});

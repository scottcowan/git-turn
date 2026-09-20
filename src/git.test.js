'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('./helpers/test-repo');
const { updateNote, getNote, addNote, headSha } = require('./git');

describe('updateNote', () => {
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

  test('merges new fields into an existing note without dropping hook fields', () => {
    const sha = headSha();
    addNote('git-turn', sha, JSON.stringify({
      session_id: 'abc123',
      turn_n: 2,
      snapshot_sha: 'deadbeef',
      ts: '2026-09-18T00:00:00.000Z',
    }));

    updateNote('git-turn', sha, existing => ({
      ...existing,
      prompt: 'hello',
      model: 'claude-sonnet-4-5',
    }));

    const note = JSON.parse(getNote('git-turn', sha));
    assert.equal(note.session_id, 'abc123');
    assert.equal(note.turn_n, 2);
    assert.equal(note.snapshot_sha, 'deadbeef');
    assert.equal(note.ts, '2026-09-18T00:00:00.000Z');
    assert.equal(note.prompt, 'hello');
    assert.equal(note.model, 'claude-sonnet-4-5');
  });

  test('a second call overwrites only the fields it provides (D-03)', () => {
    const sha = headSha();
    addNote('git-turn', sha, JSON.stringify({
      session_id: 'abc123',
      turn_n: 2,
      snapshot_sha: 'deadbeef',
      ts: '2026-09-18T00:00:00.000Z',
    }));
    updateNote('git-turn', sha, existing => ({
      ...existing,
      prompt: 'hello',
      model: 'claude-sonnet-4-5',
    }));

    updateNote('git-turn', sha, existing => ({
      ...existing,
      latency_ms: 4200,
    }));

    const note = JSON.parse(getNote('git-turn', sha));
    assert.equal(note.prompt, 'hello');
    assert.equal(note.latency_ms, 4200);
    assert.equal(note.session_id, 'abc123');
  });

  test('creates the note when none exists yet', () => {
    const sha = headSha();
    let seenExisting;
    updateNote('git-turn', sha, existing => {
      seenExisting = existing;
      return { ...existing, prompt: 'first' };
    });

    assert.deepEqual(seenExisting, {});
    const note = JSON.parse(getNote('git-turn', sha));
    assert.deepEqual(note, { prompt: 'first' });
  });

  test('treats a non-JSON existing note as an empty base', () => {
    const sha = headSha();
    addNote('git-turn', sha, 'not json at all');

    updateNote('git-turn', sha, existing => ({
      ...existing,
      model: 'm',
    }));

    const note = JSON.parse(getNote('git-turn', sha));
    assert.deepEqual(note, { model: 'm' });
  });

  test('re-runs the merge when the note changes between read and write', () => {
    const sha = headSha();
    let calls = 0;

    updateNote('git-turn', sha, existing => {
      calls += 1;
      // NOTE: this deliberately violates patchFn's purity contract solely
      // to inject a race for test purposes — a real patchFn must be pure.
      if (calls === 1) {
        addNote('git-turn', sha, JSON.stringify({ session_id: 'racer', turn_n: 9 }));
      }
      return { ...existing, prompt: 'mine' };
    });

    assert.ok(calls >= 2);
    const note = JSON.parse(getNote('git-turn', sha));
    assert.equal(note.session_id, 'racer');
    assert.equal(note.turn_n, 9);
    assert.equal(note.prompt, 'mine');
  });

  test('throws after exhausting maxRetries when a writer keeps winning', () => {
    const sha = headSha();
    let calls = 0;

    assert.throws(() => {
      updateNote('git-turn', sha, existing => {
        calls += 1;
        addNote('git-turn', sha, JSON.stringify({ call: calls }));
        return { ...existing, prompt: 'never wins' };
      }, { maxRetries: 2 });
    }, /changed concurrently/);
  });
});

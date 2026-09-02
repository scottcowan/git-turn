'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('./helpers/test-repo');
const { startSession, makeTurn } = require('./helpers/turn-fixtures');
const {
  listAllTurns,
  listAllTurnsFromRefs,
  buildHeadShaIndex,
  isAncestor,
  orderByCommitTopology,
} = require('./blame-util');

describe('blame-util cross-session enumeration', () => {
  let repoDir;
  let origCwd;
  let git;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    repoDir = repo.dir;
    git = repo.git;
    process.chdir(repoDir);
  });

  afterEach(() => {
    require('./cache').closeDb();
    process.chdir(origCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  test('listAllTurns returns turns across two distinct sessions (D-02)', () => {
    const session1 = startSession();
    makeTurn(session1, 'v1', git);
    makeTurn(session1, 'v2', git);

    const session2 = startSession();
    makeTurn(session2, 'v3', git);
    makeTurn(session2, 'v4', git);

    const turns = listAllTurns();
    assert.equal(turns.length, 4);
    const sessionIds = new Set(turns.map(t => t.session_id));
    assert.equal(sessionIds.size, 2);

    const { getTurns } = require('./cache');
    assert.equal(getTurns(session2.session_id).length, 2);
  });

  test('listAllTurns({ noCache: true }) returns the same set via ref walk', () => {
    const session1 = startSession();
    makeTurn(session1, 'v1', git);
    makeTurn(session1, 'v2', git);

    const session2 = startSession();
    makeTurn(session2, 'v3', git);
    makeTurn(session2, 'v4', git);

    const turns = listAllTurns({ noCache: true });
    assert.equal(turns.length, 4);
    for (const turn of turns) {
      assert.equal(typeof turn.head_sha, 'string');
      assert.equal(turn.head_sha.length, 40);
    }
  });

  test('listAllTurnsFromRefs returns [] when no turn refs exist', () => {
    assert.deepEqual(listAllTurnsFromRefs(), []);
  });

  test('buildHeadShaIndex maps head_sha to turn and skips null head_sha', () => {
    const session = startSession();
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const turns = listAllTurns();
    turns.push({ session_id: 'x', turn_n: 99, snapshot_sha: 'abc', head_sha: null, branch: null, ts: new Date(0).toISOString() });

    const { index, collisions } = buildHeadShaIndex(turns);
    assert.equal(collisions.length, 0);
    assert.equal(index.size, 2);
    assert.ok(!index.has(null));
  });

  test('buildHeadShaIndex reports collisions when head_sha repeats', () => {
    const session = startSession();
    const t1 = makeTurn(session, 'v1', git);

    const turns = listAllTurns();
    // Duplicate the head_sha across a synthetic second turn.
    turns.push({ session_id: session.session_id, turn_n: 2, snapshot_sha: 'dup', head_sha: t1.headSha, branch: null, ts: new Date().toISOString() });

    const { collisions } = buildHeadShaIndex(turns);
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0], t1.headSha);
  });

  test('isAncestor is true for a turn on the current branch', () => {
    const session = startSession();
    const t1 = makeTurn(session, 'v1', git);
    assert.equal(isAncestor(t1.headSha), true);
  });

  test('isAncestor is false for a sha on an unmerged branch', () => {
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    git(['checkout', '-b', 'sidebranch']);
    const session = startSession();
    const sideTurn = makeTurn(session, 'side', git);
    git(['checkout', startBranch]);

    assert.equal(isAncestor(sideTurn.headSha), false);
  });

  test('isAncestor is false for the all-zeros sha rather than throwing', () => {
    assert.doesNotThrow(() => {
      assert.equal(isAncestor('0'.repeat(40)), false);
    });
  });

  test('orderByCommitTopology returns oldest-first order matching commit ancestry', () => {
    // Sleep >1s between commits: git commit timestamps have 1-second
    // resolution, and `rev-list --no-walk`'s date-based tie-break is only
    // deterministic when commits have distinct commit times.
    const { execFileSync } = require('child_process');
    const session = startSession();
    const t1 = makeTurn(session, 'v1', git);
    execFileSync('sleep', ['1.1']);
    const t2 = makeTurn(session, 'v2', git);
    execFileSync('sleep', ['1.1']);
    const t3 = makeTurn(session, 'v3', git);

    const turns = listAllTurns();
    const ordered = orderByCommitTopology(turns);
    assert.deepEqual(ordered.map(t => t.turn_n), [t1.turn_n, t2.turn_n, t3.turn_n]);
  });

  test('orderByCommitTopology does not drop turns with null head_sha', () => {
    const session = startSession();
    makeTurn(session, 'v1', git);
    const turns = listAllTurns();
    turns.push({ session_id: session.session_id, turn_n: 99, snapshot_sha: 'abc', head_sha: null, branch: null, ts: new Date().toISOString() });

    const ordered = orderByCommitTopology(turns);
    assert.equal(ordered.length, 2);
  });
});

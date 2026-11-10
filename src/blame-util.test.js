'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('./helpers/test-repo');
const { startSession, makeTurn, makeUntrackedTurn } = require('./helpers/turn-fixtures');
const {
  listAllTurns,
  listAllTurnsFromRefs,
  buildHeadShaIndex,
  isAncestor,
  reachableFrom,
  orderByCommitTopology,
  parseHunkHeader,
  parseBlamePorcelain,
  annotateFromSnapshots,
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

  test('reachableFrom matches isAncestor for each case, in a single spawn', () => {
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const session = startSession();
    const onBranch = makeTurn(session, 'v1', git);

    git(['checkout', '-b', 'sidebranch']);
    const sideSession = startSession();
    const offBranch = makeTurn(sideSession, 'side', git);
    git(['checkout', startBranch]);

    const reachable = reachableFrom();
    assert.equal(reachable.has(onBranch.headSha), true);
    assert.equal(reachable.has(offBranch.headSha), false);
    assert.equal(reachable.has('0'.repeat(40)), false);
  });

  test('reachableFrom returns an empty set for an unreachable rev rather than throwing', () => {
    assert.doesNotThrow(() => {
      const reachable = reachableFrom('does-not-exist');
      assert.equal(reachable.size, 0);
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

describe('blame-util parsers', () => {
  test('parseHunkHeader parses a standard two-sided hunk header', () => {
    assert.deepEqual(parseHunkHeader('@@ -1,3 +1,4 @@'), {
      oldStart: 1, oldCount: 3, newStart: 1, newCount: 4,
    });
  });

  test('parseHunkHeader defaults omitted counts to 1', () => {
    assert.deepEqual(parseHunkHeader('@@ -5 +5 @@'), {
      oldStart: 5, oldCount: 1, newStart: 5, newCount: 1,
    });
  });

  test('parseHunkHeader parses a hunk with a trailing section heading', () => {
    assert.deepEqual(parseHunkHeader('@@ -0,0 +1,2 @@ some context'), {
      oldStart: 0, oldCount: 0, newStart: 1, newCount: 2,
    });
  });

  test('parseHunkHeader returns null for a non-hunk line', () => {
    assert.equal(parseHunkHeader('not a hunk'), null);
  });

  test('parseBlamePorcelain parses a two-line porcelain sample', () => {
    const sha1 = 'a'.repeat(40);
    const sha2 = 'b'.repeat(40);
    const sample = [
      `${sha1} 1 1 2`,
      'author Test',
      'summary turn 1',
      '\tfirst line',
      `${sha2} 2 2`,
      'author Test',
      '\tsecond line',
    ].join('\n');

    const records = parseBlamePorcelain(sample);
    assert.deepEqual(records, [
      { sha: sha1, line_no: 1, content: 'first line' },
      { sha: sha2, line_no: 2, content: 'second line' },
    ]);
  });

  test('parseBlamePorcelain returns [] for empty input', () => {
    assert.deepEqual(parseBlamePorcelain(''), []);
  });
});

describe('annotateFromSnapshots', () => {
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

  test('attributes untracked-only lines to the turn that introduced/appended them', () => {
    const { execFileSync } = require('child_process');
    const session = startSession();
    const t1 = makeUntrackedTurn(session, 'line1\nline2', git, { file: 'notes.txt' });
    execFileSync('sleep', ['1.1']);
    const t2 = makeUntrackedTurn(session, 'line1\nline2', git, { file: 'notes.txt' });
    execFileSync('sleep', ['1.1']);
    const t3 = makeUntrackedTurn(session, 'line1\nline2\nline3', git, { file: 'notes.txt' });

    const turns = orderByCommitTopology(listAllTurns());
    const result = annotateFromSnapshots('notes.txt', turns);

    assert.deepEqual(result.map(r => r.line_no), [1, 2, 3]);
    assert.deepEqual(result.map(r => r.content), ['line1', 'line2', 'line3']);
    assert.equal(result[0].turn.turn_n, t1.turn_n);
    assert.equal(result[1].turn.turn_n, t1.turn_n);
    assert.equal(result[2].turn.turn_n, t3.turn_n);
    void t2;
  });

  test('untracked file with colon in name is attributed (WR-04 characterization)', () => {
    const session = startSession();
    const t1 = makeUntrackedTurn(session, 'hello', git, { file: 'a:b.txt' });
    const turns = orderByCommitTopology(listAllTurns());
    const result = annotateFromSnapshots('a:b.txt', turns);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'hello');
    assert.equal(result[0].turn.turn_n, t1.turn_n);
  });
});

'use strict';

// Cross-session turn enumeration, head_sha reverse index, topology ordering,
// ancestry check, and (Task 3) unified-diff hunk + blame-porcelain parsers
// plus the untracked-file forward annotator. All git access goes through
// git/gitSafe from ./git — never child_process directly.

const { gitSafe } = require('./git');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function sortTurns(turns) {
  return turns.slice().sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.session_id !== b.session_id) return a.session_id < b.session_id ? -1 : 1;
    return a.turn_n - b.turn_n;
  });
}

// Ref-walk fallback — mirrors cache.js rebuild()'s for-each-ref walk exactly,
// producing the normalized turn shape { session_id, turn_n, snapshot_sha,
// head_sha, branch, ts } from refs/git-turn/sessions/ directly.
function listAllTurnsFromRefs() {
  const refOutput = gitSafe(['for-each-ref',
    '--format=%(refname) %(objectname)',
    '--sort=refname',
    'refs/git-turn/sessions/']) || '';

  const turns = [];
  for (const line of refOutput.split('\n').filter(Boolean)) {
    const [ref, sha] = line.split(' ');
    const m = ref.match(/refs\/git-turn\/sessions\/([^/]+)\/turn-(\d+)/);
    if (!m) continue;
    const [, sessionId, turnNStr] = m;
    const turnN = parseInt(turnNStr, 10);

    const msg = gitSafe(['log', '-1', '--format=%B', sha]) || '';
    let headSha = null, branch = null, ts = new Date(0).toISOString();
    for (const msgLine of msg.split('\n')) {
      if (msgLine.startsWith('head ')) headSha = msgLine.slice(5).trim();
      if (msgLine.startsWith('branch ')) branch = msgLine.slice(7).trim();
      if (msgLine.startsWith('created ')) ts = msgLine.slice(8).trim();
    }

    turns.push({
      session_id: sessionId,
      turn_n: turnN,
      snapshot_sha: sha,
      head_sha: headSha,
      branch,
      ts,
    });
  }

  return sortTurns(turns);
}

// Cache-first cross-session turn enumeration, falling back to the ref walk
// when the cache is empty or unavailable. Mirrors log.js's cache-first shape.
function listAllTurns({ noCache = false } = {}) {
  if (!noCache) {
    try {
      const { getAllTurns } = require('./cache');
      const cached = getAllTurns();
      if (cached.length > 0) return cached;
    } catch {
      // Cache unavailable — fall through to the ref walk.
    }
  }
  return listAllTurnsFromRefs();
}

// Build a Map<head_sha, Turn> reverse index. Skips turns with a falsy
// head_sha rather than keying null in the map. Reports any head_sha seen
// more than once in `collisions` (keeps the first turn seen, deterministic).
function buildHeadShaIndex(turns) {
  const index = new Map();
  const collisions = [];
  for (const turn of turns) {
    if (!turn.head_sha) continue;
    if (index.has(turn.head_sha)) {
      collisions.push(turn.head_sha);
      continue;
    }
    index.set(turn.head_sha, turn);
  }
  return { index, collisions };
}

// True if `sha` is an ancestor of `rev` (default HEAD). Never throws —
// gitSafe already swallows the nonzero-exit throw from merge-base.
function isAncestor(sha, rev = 'HEAD') {
  if (!sha) return false;
  return gitSafe(['merge-base', '--is-ancestor', sha, rev]) !== null;
}

// Order turns oldest-first by real commit ancestry of head_sha, never by
// walking the snapshot-ref DAG (snapshot parents are real HEAD, not the
// prior snapshot — see 03-RESEARCH.md Pitfall 1).
function orderByCommitTopology(turns) {
  const shas = [...new Set(turns.map(t => t.head_sha).filter(Boolean))];
  const rank = new Map();
  if (shas.length > 0) {
    const out = gitSafe(['rev-list', '--topo-order', '--reverse', '--no-walk', ...shas]) || '';
    out.split('\n').filter(Boolean).forEach((sha, i) => rank.set(sha, i));
  }

  return turns.slice().sort((a, b) => {
    const ra = a.head_sha && rank.has(a.head_sha) ? rank.get(a.head_sha) : Number.MAX_SAFE_INTEGER;
    const rb = b.head_sha && rank.has(b.head_sha) ? rank.get(b.head_sha) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.session_id !== b.session_id) return a.session_id < b.session_id ? -1 : 1;
    return a.turn_n - b.turn_n;
  });
}

module.exports = {
  listAllTurns,
  listAllTurnsFromRefs,
  buildHeadShaIndex,
  isAncestor,
  orderByCommitTopology,
};

'use strict';

const { gitSafe, shouldColor } = require('../git');
const { readSession, listTurns } = require('../session');
const { renderRich, parseDiff, EMPTY_TREE } = require('../diff-render');

function compute(args, opts = {}) {
  const session = readSession();
  if (!session) {
    throw new Error('git turn: not initialized. Run `git turn init` first.');
  }

  const positional = args.filter(a => a !== '--json' && a !== '--plain');

  const N = parseInt(positional[0], 10);
  if (isNaN(N)) {
    throw new Error('Usage: git turn diff <N> [M]');
  }

  let M = null;
  if (positional[1] !== undefined) {
    M = parseInt(positional[1], 10);
    if (isNaN(M)) {
      throw new Error('Usage: git turn diff <N> [M]');
    }
  }

  const turns = listTurns(session.session_id);

  function findTurn(n) {
    const t = turns.find(t => t.turn_n === n);
    if (!t) {
      throw new Error('git turn: turn ' + n + ' not found');
    }
    return t;
  }

  let shaA, shaB, fromTurn, toTurn;

  if (M !== null) {
    // D-04 — two explicit turns
    shaA = findTurn(N).sha;
    shaB = findTurn(M).sha;
    fromTurn = N;
    toTurn = M;
  } else {
    // D-05 — single turn, diff N-1 vs N
    shaB = findTurn(N).sha;
    const prevTurn = turns.find(t => t.turn_n === N - 1);
    shaA = prevTurn ? prevTurn.sha : EMPTY_TREE;
    fromTurn = prevTurn ? N - 1 : null;
    toTurn = N;
  }

  const json = args.includes('--json');
  const plain = args.includes('--plain');

  if (json) {
    const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
    const { added, removed } = parseDiff(raw);
    return JSON.stringify({ from_turn: fromTurn, to_turn: toTurn, sha_a: shaA, sha_b: shaB, diff: raw, added, removed });
  }

  if (plain) {
    const colorArg = shouldColor() ? '--color=always' : '--color=never';
    return gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)';
  }

  const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
  return renderRich(raw, { color: shouldColor(), width: process.stdout.columns || 120 });
}

function run(args) {
  try {
    console.log(compute(args, { stderr: (s) => process.stderr.write(s) }));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
      return;
    }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };

'use strict';

const { gitSafe } = require('../git');
const { readSession, listTurns } = require('../session');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const N = parseInt(args[0], 10);
  if (isNaN(N)) {
    console.error('Usage: git turn diff <N> [M]');
    process.exit(1);
  }

  let M = null;
  if (args[1] !== undefined) {
    M = parseInt(args[1], 10);
    if (isNaN(M)) {
      console.error('Usage: git turn diff <N> [M]');
      process.exit(1);
    }
  }

  const turns = listTurns(session.session_id);

  function findTurn(n) {
    const t = turns.find(t => t.turn_n === n);
    if (!t) {
      console.error('git turn: turn ' + n + ' not found');
      process.exit(1);
    }
    return t;
  }

  let shaA, shaB;

  if (M !== null) {
    // D-04 — two explicit turns
    shaA = findTurn(N).sha;
    shaB = findTurn(M).sha;
  } else {
    // D-05 — single turn, diff N-1 vs N
    shaB = findTurn(N).sha;
    const prevTurn = turns.find(t => t.turn_n === N - 1);
    shaA = prevTurn ? prevTurn.sha : EMPTY_TREE;
  }

  const out = gitSafe(['diff', shaA, shaB]) || '(no changes)';
  console.log(out);
}

module.exports = { run };

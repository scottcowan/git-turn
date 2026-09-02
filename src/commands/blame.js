'use strict';

const { gitSafe } = require('../git');
const { readSession } = require('../session');
const blameUtil = require('../blame-util');

const ZERO_SHA = '0'.repeat(40);

// Shared per-line formatter for both the tracked-git-blame path and the
// untracked-snapshot fallback path, so they cannot drift on padding.
function formatLine(attr, lineNo, content) {
  return `${attr.padEnd(24)} ${String(lineNo).padStart(4)}) ${content}`;
}

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const noCache = args.includes('--no-cache');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: git turn blame <file> [--no-cache]');
    process.exit(1);
  }

  // Single listAllTurns call per invocation, regardless of which branch runs.
  const turns = blameUtil.listAllTurns({ noCache });

  const tracked = gitSafe(['ls-files', '--', file]);
  if (tracked) {
    const { index, collisions } = blameUtil.buildHeadShaIndex(turns);
    if (collisions.length > 0) {
      process.stderr.write(`git turn: warning: ${collisions.length} duplicate head_sha value(s) in turn history; attribution may be ambiguous\n`);
    }

    const blameOut = gitSafe(['blame', '--porcelain', '--', file]);
    if (blameOut === null) {
      console.error(`git turn: no history for ${file}`);
      process.exit(1);
    }

    const records = blameUtil.parseBlamePorcelain(blameOut);
    console.log(`Blame: ${file}`);
    console.log('');
    for (const rec of records) {
      let attr;
      if (rec.sha === ZERO_SHA) {
        attr = '(uncommitted)';
      } else {
        const turn = index.get(rec.sha);
        attr = turn ? `${turn.session_id.slice(0, 8)}:${turn.turn_n}` : `${rec.sha.slice(0, 7)} (not a turn)`;
      }
      console.log(formatLine(attr, rec.line_no, rec.content));
    }
    return;
  }

  // Untracked-snapshot fallback: real git blame has no record of this path.
  const orderedTurns = blameUtil.orderByCommitTopology(turns);
  const annotated = blameUtil.annotateFromSnapshots(file, orderedTurns);
  if (annotated.length === 0) {
    console.error(`git turn: no history for ${file}`);
    process.exit(1);
  }

  console.log(`Blame: ${file}`);
  console.log('(untracked — annotated from turn snapshots)');
  console.log('');
  for (const { line_no, content, turn } of annotated) {
    const attr = turn ? `${turn.session_id.slice(0, 8)}:${turn.turn_n}` : '(unattributed)';
    console.log(formatLine(attr, line_no, content));
  }
}

module.exports = { run };

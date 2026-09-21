'use strict';

const { git, gitSafe, shouldColor } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');

function run(args) {
  const session = readSession();
  if (!session) { console.error('git turn: not initialized'); process.exit(1); }

  const turnN = parseInt(args[0], 10);
  if (isNaN(turnN)) { console.error('Usage: git turn show <N>'); process.exit(1); }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === turnN);
  const prev = turns.find(t => t.turn_n === turnN - 1);

  if (!turn) { console.error(`git turn: turn ${turnN} not found`); process.exit(1); }

  const withPrompts = args.includes('--with-prompts');

  // Real HEAD sha lives in the snapshot commit's own message body, not
  // notes — refs/notes/git-turn has never carried a `head` field.
  const { headSha } = parseSnapshotMessage(turn.sha);
  const head = headSha || turn.sha;

  // Get metadata from note
  const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head]);
  let meta = {};
  try { meta = note ? JSON.parse(note) : {}; } catch {}

  // Header
  console.log(`Turn ${turnN}  ${head.slice(0, 7)}  ${new Date(meta.ts || 0).toLocaleString()}`);
  if (meta.model) console.log(`Model: ${meta.model}`);
  if (meta.latency_ms) console.log(`Latency: ${meta.latency_ms}ms`);
  if (withPrompts && meta.prompt) {
    console.log(`\nPrompt:\n  ${meta.prompt.replace(/\n/g, '\n  ')}`);
  }
  console.log('');

  // Diff: worktree-tree of this turn vs previous turn
  const colorArg = shouldColor() ? '--color=always' : '--color=never';
  if (prev) {
    const diffOut = gitSafe(['diff', colorArg, prev.sha, turn.sha]) || '(no changes)';
    console.log(diffOut);
  } else {
    // First turn — diff against empty tree
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const diffOut = gitSafe(['diff', colorArg, emptyTree, turn.sha]) || '(no changes)';
    console.log(diffOut);
  }
}

module.exports = { run };

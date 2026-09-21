'use strict';

// redact <N>: post-hoc remediation for the case where a secret made it into a
// turn's captured prompt anyway. Per D-01 only the freeform `prompt` field is
// scrubbed — model/usage/latency_ms/tool_summary are structured/enumerable
// and are not where a leaked secret realistically lives. Per D-02 this runs
// immediately with no confirmation prompt, matching revert/redo.
//
// Note: this does NOT delete the old blob from the object store — the note
// history still contains it until `git turn gc --purge-notes` (plan 06-04)
// runs. That relationship is surfaced to the user on every successful redact.

const { updateNote, getNote } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const turnN = parseInt(args[0], 10);
  if (isNaN(turnN)) {
    console.error('Usage: git turn redact <N>');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === turnN);
  if (!turn) {
    console.error(`git turn: turn ${turnN} not found`);
    process.exit(1);
  }

  // Real HEAD sha lives in the snapshot commit's own message body, not
  // notes — resolve it the same way show.js/log.js/cost.js do, never the
  // bare snapshot sha (mitigates T-06-03).
  const { headSha } = parseSnapshotMessage(turn.sha);
  const noteSha = headSha || turn.sha;

  const before = getNote(NOTES_REF, noteSha);
  let existing = {};
  try { existing = before ? JSON.parse(before) : {}; } catch { existing = {}; }

  if (!existing.prompt) {
    console.log(`Turn ${turnN}: no prompt recorded, nothing to redact`);
    return;
  }

  updateNote(NOTES_REF, noteSha, existing => ({ ...existing, prompt: '[REDACTED]' }));

  try {
    const { updatePromptFields } = require('../cache');
    updatePromptFields(session.session_id, turnN, { prompt: '[REDACTED]' });
  } catch (e) {
    process.stderr.write(`git turn: warning: cache update failed (${e.message})\n`);
  }

  console.log(`Turn ${turnN}: prompt redacted`);
  console.log('Note history still contains the old blob — run `git turn gc --purge-notes` to remove it.');
}

module.exports = { run };

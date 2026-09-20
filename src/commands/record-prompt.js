'use strict';

// record-prompt: reads a single JSON blob from stdin ({ prompt, model,
// usage, latency_ms, tool_summary }, all fields optional) and merges the
// supplied fields into the latest turn's note (D-02: never bare HEAD,
// always the turn-index target) plus a best-effort SQLite cache update.
// Merge-not-overwrite (D-03) is delegated entirely to updateNote()'s
// read-compare-retry — this command never performs a blind note-write call.

const fs = require('fs');
const { updateNote } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
const { redact } = require('../redact');

// Read all of stdin synchronously. fd 0 is a real pipe under
// `echo '{...}' | git turn record-prompt`; returns null on any failure
// (e.g. an interactive TTY with nothing piped in).
function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const raw = readStdinSync();
  if (!raw || !raw.trim()) {
    console.error('git turn: record-prompt requires a JSON payload on stdin');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error(`git turn: invalid JSON on stdin: ${e.message}`);
    process.exit(1);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('git turn: invalid JSON on stdin: a JSON object is required');
    process.exit(1);
  }

  if (payload.prompt !== undefined) {
    if (typeof payload.prompt !== 'string') {
      console.error('git turn: prompt must be a string');
      process.exit(1);
    }
    const { text, count } = redact(payload.prompt);
    payload.prompt = text;
    if (count > 0) {
      process.stderr.write(`git turn: redacted ${count} potential secret(s) from prompt\n`);
    }
  }

  if (payload.usage !== undefined) {
    if (payload.usage === null || typeof payload.usage !== 'object' || Array.isArray(payload.usage)) {
      console.error('git turn: usage must be a JSON object');
      process.exit(1);
    }
  }

  if (payload.model !== undefined && typeof payload.model !== 'string') {
    console.error('git turn: model must be a string');
    process.exit(1);
  }

  if (payload.tool_summary !== undefined) {
    if (payload.tool_summary === null || typeof payload.tool_summary !== 'object' || Array.isArray(payload.tool_summary)) {
      console.error('git turn: tool_summary must be a JSON object');
      process.exit(1);
    }
  }

  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    console.error('git turn: no turns yet this session. Make a commit first.');
    process.exit(1);
  }
  const latest = turns[turns.length - 1]; // listTurns() already sorts ascending by turn_n
  const { headSha } = parseSnapshotMessage(latest.sha);
  if (!headSha) {
    console.error('git turn: could not resolve head commit for the latest turn');
    process.exit(1);
  }

  updateNote(NOTES_REF, headSha, existing => ({
    ...existing,
    ...(payload.prompt !== undefined && { prompt: payload.prompt }),
    ...(payload.model !== undefined && { model: payload.model }),
    ...(payload.latency_ms !== undefined && { latency_ms: payload.latency_ms }),
    ...(payload.usage !== undefined && { usage: payload.usage }),
    ...(payload.tool_summary !== undefined && { tool_summary: payload.tool_summary }),
  }));

  try {
    const { updatePromptFields } = require('../cache');
    updatePromptFields(session.session_id, latest.turn_n, {
      prompt: payload.prompt,
      model: payload.model,
      latencyMs: payload.latency_ms,
      usage: payload.usage,
      toolSummary: payload.tool_summary,
    });
  } catch (e) {
    process.stderr.write(`git turn: warning: cache update failed (${e.message})\n`);
  }

  console.log(`Turn ${latest.turn_n}: recorded ${Object.keys(payload).join(', ')}`);
}

module.exports = { run };

'use strict';

const { gitSafe, shouldColor } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');
const { renderRich, parseDiff, EMPTY_TREE } = require('../diff-render');

function compute(args, opts = {}) {
  const session = readSession();
  if (!session) {
    throw new Error('git turn: not initialized');
  }

  const positional = args.filter(a => a !== '--json' && a !== '--plain');

  const turnN = parseInt(positional[0], 10);
  if (isNaN(turnN)) {
    throw new Error('Usage: git turn show <N>');
  }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === turnN);
  const prev = turns.find(t => t.turn_n === turnN - 1);

  if (!turn) {
    throw new Error(`git turn: turn ${turnN} not found`);
  }

  const withPrompts = args.includes('--with-prompts');

  // Real HEAD sha lives in the snapshot commit's own message body, not
  // notes — refs/notes/git-turn has never carried a `head` field.
  const { headSha } = parseSnapshotMessage(turn.sha);
  const head = headSha || turn.sha;

  // Get metadata from note
  const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head]);
  let meta = {};
  try { meta = note ? JSON.parse(note) : {}; } catch {}

  const shaA = prev ? prev.sha : EMPTY_TREE;
  const shaB = turn.sha;

  const json = args.includes('--json');
  const plain = args.includes('--plain');

  if (json) {
    const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
    const { added, removed } = parseDiff(raw);
    return JSON.stringify({
      turn: turnN,
      sha: head,
      snapshot_sha: turn.sha,
      ts: meta.ts ?? null,
      model: meta.model ?? null,
      latency_ms: meta.latency_ms ?? null,
      usage: meta.usage ?? null,
      tool_summary: meta.tool_summary ?? null,
      ...(withPrompts && meta.prompt ? { prompt: meta.prompt } : {}),
      from_sha: shaA,
      to_sha: shaB,
      diff: raw,
      added,
      removed,
    });
  }

  const lines = [];

  // Header
  lines.push(`Turn ${turnN}  ${head.slice(0, 7)}  ${new Date(meta.ts || 0).toLocaleString()}`);
  if (meta.model) lines.push(`Model: ${meta.model}`);
  if (meta.latency_ms) lines.push(`Latency: ${meta.latency_ms}ms`);
  if (withPrompts && meta.prompt) {
    lines.push(`\nPrompt:\n  ${meta.prompt.replace(/\n/g, '\n  ')}`);
  }
  lines.push('');

  if (plain) {
    const colorArg = shouldColor() ? '--color=always' : '--color=never';
    lines.push(gitSafe(['diff', colorArg, shaA, shaB]) || '(no changes)');
  } else {
    const raw = gitSafe(['diff', '--color=never', shaA, shaB]) || '';
    lines.push(renderRich(raw, { color: shouldColor(), width: process.stdout.columns || 120 }));
  }

  return lines.join('\n');
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

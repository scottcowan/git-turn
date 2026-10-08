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

// Pure compute: resolves attribution for every line of `file` exactly once
// and returns either the text rendering or (with --json) the structured
// shape, built from the SAME attribution records so the two can never
// drift. Throws Error (never console/process) on any failure; writes to
// opts.stderr (never process.stderr directly) when the sink is supplied.
function compute(args, opts = {}) {
  const session = readSession();
  if (!session) {
    throw new Error('git turn: not initialized. Run `git turn init` first.');
  }

  const noCache = args.includes('--no-cache');
  const json = args.includes('--json');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    throw new Error('Usage: git turn blame <file> [--no-cache]');
  }

  // Single listAllTurns call per invocation, regardless of which branch runs.
  const turns = blameUtil.listAllTurns({ noCache });

  const tracked = gitSafe(['ls-files', '--', file]);
  const warnings = [];
  let records;
  let trackedBool;

  if (tracked) {
    trackedBool = true;
    const { index, collisions } = blameUtil.buildHeadShaIndex(turns);
    if (collisions.length > 0) {
      const warnMsg = `${collisions.length} duplicate head_sha value(s) in turn history; attribution may be ambiguous`;
      warnings.push(warnMsg);
      if (opts.stderr) opts.stderr(`git turn: warning: ${warnMsg}\n`);
    }

    const blameOut = gitSafe(['blame', '--porcelain', '--', file]);
    if (blameOut === null) {
      throw new Error(`git turn: no history for ${file}`);
    }

    const parsed = blameUtil.parseBlamePorcelain(blameOut);
    records = parsed.map(rec => {
      if (rec.sha === ZERO_SHA) {
        return { line: rec.line_no, attribution: '(uncommitted)', session_id: null, turn: null, content: rec.content };
      }
      const turn = index.get(rec.sha);
      if (turn) {
        return {
          line: rec.line_no,
          attribution: `${turn.session_id.slice(0, 8)}:${turn.turn_n}`,
          session_id: turn.session_id,
          turn: turn.turn_n,
          content: rec.content,
        };
      }
      return { line: rec.line_no, attribution: `${rec.sha.slice(0, 7)} (not a turn)`, session_id: null, turn: null, content: rec.content };
    });
  } else {
    // Untracked-snapshot fallback: real git blame has no record of this path.
    trackedBool = false;
    const orderedTurns = blameUtil.orderByCommitTopology(turns);
    const annotated = blameUtil.annotateFromSnapshots(file, orderedTurns);
    if (annotated.length === 0) {
      throw new Error(`git turn: no history for ${file}`);
    }

    records = annotated.map(({ line_no, content, turn }) => {
      if (turn) {
        return {
          line: line_no,
          attribution: `${turn.session_id.slice(0, 8)}:${turn.turn_n}`,
          session_id: turn.session_id,
          turn: turn.turn_n,
          content,
        };
      }
      return { line: line_no, attribution: '(unattributed)', session_id: null, turn: null, content };
    });
  }

  if (json) {
    return JSON.stringify({ file, tracked: trackedBool, warnings, lines: records });
  }

  const lines = [];
  lines.push(`Blame: ${file}`);
  if (!trackedBool) lines.push('(untracked — annotated from turn snapshots)');
  lines.push('');
  for (const rec of records) {
    lines.push(formatLine(rec.attribution, rec.line, rec.content));
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

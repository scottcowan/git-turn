'use strict';

const { spawnSync } = require('child_process');
const { listRefs, gitSafe } = require('../git');
const { NOTES_REF } = require('../session');

// Every ref git-turn owns: the format discovery blob, every session's
// turn-N and meta refs, and the notes ref (if any notes have been written).
// Scoped deliberately to just this namespace so an export can hand off
// session/turn history between repos without granting full repo access.
function gitTurnRefs() {
  const refs = listRefs('refs/git-turn/').map(r => r.ref);
  if (gitSafe(['rev-parse', '--verify', NOTES_REF])) refs.push(NOTES_REF);
  return refs;
}

function run(args) {
  const sinceIdx = args.indexOf('--since');
  const since = sinceIdx !== -1 ? args[sinceIdx + 1] : null;
  if (sinceIdx !== -1 && !since) {
    console.error('git turn: --since requires a ref');
    process.exit(1);
  }
  if (since && !gitSafe(['rev-parse', '--verify', since])) {
    console.error(`git turn: --since ref '${since}' does not exist`);
    process.exit(1);
  }

  const outIdx = args.indexOf('--output');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : `git-turn-export-${Date.now()}.bundle`;
  if (outIdx !== -1 && !outPath) {
    console.error('git turn: --output requires a path');
    process.exit(1);
  }

  const refs = gitTurnRefs();
  if (refs.length === 0) {
    console.error('git turn: no git-turn refs found — nothing to export. Run `git turn init` and make a few turns first.');
    process.exit(1);
  }

  const bundleArgs = ['bundle', 'create', outPath, ...refs];
  if (since) bundleArgs.push(`^${since}`);

  const result = spawnSync('git', bundleArgs, { encoding: 'utf8', cwd: process.cwd() });
  if (result.status !== 0) {
    console.error('git turn: export failed:', (result.stderr || '').trim());
    process.exit(1);
  }

  console.log(`✓ Exported ${refs.length} ref(s) to ${outPath}`);
  if (since) console.log(`  (incremental — excludes everything reachable from ${since})`);
}

module.exports = { run };

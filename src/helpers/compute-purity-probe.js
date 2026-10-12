'use strict';

// Standalone child-process probe (T-07-21). Run as:
//   node compute-purity-probe.js <mode>
// where <mode> is 'ready' (session exists — success + not-found error
// cases) or 'uninit' (session.json deleted — not-initialized error cases).
//
// Stubs every output sink (console.*, process.stdout/stderr.write,
// process.exit) BEFORE requiring/calling any compute(), so if a compute()
// path ever writes or exits without an injected opts.stderr sink, it is
// caught here rather than silently passing. process.exit's stub additionally
// throws 'PROBE_EXIT' so a compute() that calls it never returns normally.
//
// This runs in its own process (not inside node:test) so the stubbing never
// touches node:test's own reporter stream.

const calls = [];

const origStdoutWrite = process.stdout.write.bind(process.stdout);

function recordCall(sink, args) {
  calls.push({ sink, args: args.map(a => (typeof a === 'string' ? a : String(a))) });
}

console.log = (...args) => recordCall('console.log', args);
console.error = (...args) => recordCall('console.error', args);
console.warn = (...args) => recordCall('console.warn', args);
console.info = (...args) => recordCall('console.info', args);
process.stdout.write = (...args) => { recordCall('process.stdout.write', [args[0]]); return true; };
process.stderr.write = (...args) => { recordCall('process.stderr.write', [args[0]]); return true; };
process.exit = (code) => {
  recordCall('process.exit', [code]);
  throw new Error('PROBE_EXIT');
};

const log = require('../commands/log');
const show = require('../commands/show');
const diff = require('../commands/diff');
const blame = require('../commands/blame');
const cost = require('../commands/cost');

const mode = process.argv[2];

function readyCases() {
  return [
    { cmd: 'log', args: [] },
    { cmd: 'log', args: ['--no-cache'] },
    { cmd: 'log', args: ['--json'] },
    { cmd: 'log', args: ['--no-cache', '--json'] },
    { cmd: 'show', args: ['1'] },
    { cmd: 'show', args: ['1', '--plain'] },
    { cmd: 'show', args: ['1', '--json'] },
    { cmd: 'diff', args: ['2'] },
    { cmd: 'diff', args: ['1', '2', '--plain'] },
    { cmd: 'diff', args: ['1', '2', '--json'] },
    { cmd: 'blame', args: ['work.txt'] },
    { cmd: 'blame', args: ['work.txt', '--json'] },
    { cmd: 'cost', args: [] },
    { cmd: 'cost', args: ['--json'] },
    // not-found error cases — still against the ready session.
    { cmd: 'show', args: ['99'] },
    { cmd: 'diff', args: ['abc'] },
    { cmd: 'diff', args: ['99'] },
    { cmd: 'blame', args: [] },
    { cmd: 'blame', args: ['nonexistent.txt'] },
  ];
}

function uninitCases() {
  return [
    { cmd: 'log', args: [] },
    { cmd: 'show', args: ['1'] },
    { cmd: 'diff', args: ['1'] },
    { cmd: 'blame', args: ['work.txt'] },
    { cmd: 'cost', args: [] },
  ];
}

const modules = { log, show, diff, blame, cost };

async function runCase({ cmd, args }) {
  const callsBefore = calls.length;
  let ok = false;
  let resultType = null;
  let jsonParses = null;
  let errorIsError = null;
  let errorMessage = null;

  try {
    const result = await modules[cmd].compute(args);
    ok = true;
    resultType = typeof result;
    if (args.includes('--json')) {
      try {
        JSON.parse(result);
        jsonParses = true;
      } catch {
        jsonParses = false;
      }
    }
  } catch (e) {
    ok = false;
    errorIsError = e instanceof Error;
    errorMessage = e && e.message;
  }

  const callsDuring = calls.slice(callsBefore);
  return { cmd, args, ok, resultType, jsonParses, errorIsError, errorMessage, calls: callsDuring };
}

async function main() {
  if (mode === 'uninit') {
    const { gitDir } = require('../git');
    const path = require('path');
    const fs = require('fs');
    fs.rmSync(path.join(gitDir(), 'git-turn', 'session.json'), { force: true });
  }

  const cases = mode === 'uninit' ? uninitCases() : readyCases();
  const report = [];
  for (const c of cases) {
    report.push(await runCase(c));
  }

  origStdoutWrite(JSON.stringify(report));
}

main();

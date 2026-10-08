'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

describe('cost command', () => {
  let dir, origCwd, origHome, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    // T-06-07/T-06-08: redirect os.homedir() to the throwaway temp repo dir
    // so cost.js's pricingCachePath() never touches the developer's real
    // ~/.git-turn-pricing.json and never falls through to a network fetch.
    process.env.HOME = dir;

    const { startSession } = require('../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  // Pre-seeds a fresh pricing cache so loadPricing()'s TTL short-circuit
  // fires before fetchPricing() is ever reached (T-06-08).
  function seedFakePricing(dir, modelKey, priceEntry) {
    writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({
      _fetched_at: Date.now(),
      data: { [modelKey]: priceEntry },
    }));
  }

  // Seeds the exact hook-shipped note payload on a freshly-made turn, so
  // tests reproduce the pre-existing state a real post-commit hook would
  // have left behind before record-prompt ever runs.
  function seedHookNote() {
    const { makeTurn } = require('../helpers/turn-fixtures');
    const { addNote } = require('../git');
    const { NOTES_REF } = require('../session');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
    }));
    return { headSha, snapshotSha };
  }

  // Monkeypatches fs.readFileSync so fd 0 returns the given payload, drives
  // a real record-prompt run to attach model/usage to the note.
  function runWithStdin(payloadOrRawString) {
    const fsMod = require('fs');
    const origRead = fsMod.readFileSync;
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    const origStderrWrite = process.stderr.write;

    const out = [];
    const err = [];
    let exitCode = null;

    fsMod.readFileSync = (fd, enc) => {
      if (fd === 0) {
        return typeof payloadOrRawString === 'string'
          ? payloadOrRawString
          : JSON.stringify(payloadOrRawString);
      }
      return origRead(fd, enc);
    };
    console.log = (...args) => out.push(args.join(' '));
    console.error = (...args) => err.push(args.join(' '));
    process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./record-prompt')];
      require('./record-prompt').run([]);
    } catch (e) {
      const m = /^EXIT:(\d+)$/.exec(e.message);
      if (m) {
        exitCode = parseInt(m[1], 10);
      } else {
        throw e;
      }
    } finally {
      fsMod.readFileSync = origRead;
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
      process.exit = origExit;
    }

    return { out, err: err.join('\n'), exitCode };
  }

  // cost.js's run() is the project's one async command — swap console/exit,
  // await it, and restore all stubs in finally.
  async function captureCostAsync(args) {
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    const origStderrWrite = process.stderr.write;

    const out = [];
    const err = [];
    let exitCode = null;

    console.log = (...args2) => out.push(args2.join(' '));
    console.error = (...args2) => err.push(args2.join(' '));
    process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./cost')];
      await require('./cost').run(args || []);
    } catch (e) {
      const m = /^EXIT:(\d+)$/.exec(e.message);
      if (m) {
        exitCode = parseInt(m[1], 10);
      } else {
        throw e;
      }
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
      process.exit = origExit;
    }

    return { out, err: err.join('\n'), exitCode };
  }

  test('VERIFY-02: cost with a seeded pricing fixture and a real record-prompt note prints the real model name', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    const { out } = await captureCostAsync([]);
    const combined = out.join('\n');
    assert.match(combined, /claude-sonnet-4-5/);
    assert.ok(!combined.includes('no model recorded'));
  });

  test('VERIFY-02: cost prints $0.0105 for usage against the seeded price entry', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    const { out } = await captureCostAsync([]);
    const combined = out.join('\n');
    assert.match(combined, /\$0\.0105/);
  });

  test('VERIFY-02: cost prints a Total cost line reporting 1/1 turns', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    const { out } = await captureCostAsync([]);
    const combined = out.join('\n');
    assert.match(combined, /Total cost \(1\/1 turns\)/);
  });

  test('cost on a session with no turns prints "No turns yet this session." and makes no network call', async () => {
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });

    const { out } = await captureCostAsync([]);
    const combined = out.join('\n');
    assert.match(combined, /No turns yet this session\./);
  });

  // Task 1: async compute()/run() split — compute() must be write-free
  // without opts, resolve/reject with the documented strings, and route
  // all progress/error text through opts.stderr / thrown Error only.

  test('compute() resolves to a string reporting $0.0105 for 1/1 turns', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    delete require.cache[require.resolve('./cost')];
    const result = await require('./cost').compute([]);
    assert.match(result, /Total cost \(1\/1 turns\): \$0\.0105/);
  });

  test('compute() with no session rejects with the not-initialized Error message', async () => {
    const { gitDir } = require('../git');
    const { rmSync: rm } = require('fs');
    rm(join(gitDir(), 'git-turn', 'session.json'), { force: true });

    delete require.cache[require.resolve('./cost')];
    await assert.rejects(
      require('./cost').compute([]),
      { message: 'git turn: not initialized. Run `git turn init` first.' }
    );
  });

  test('compute(args, { stderr }) calls the sink with the fetching line then the clearing line, in order', async () => {
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });

    const calls = [];
    delete require.cache[require.resolve('./cost')];
    await require('./cost').compute([], { stderr: (s) => calls.push(s) });

    assert.deepEqual(calls, ['Fetching pricing data...\r', '                        \r']);
  });

  test('compute() with no opts never calls console/process stubs', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    const origStderrWrite = process.stderr.write;

    console.log = () => { throw new Error('console.log called'); };
    console.error = () => { throw new Error('console.error called'); };
    process.exit = () => { throw new Error('process.exit called'); };
    process.stderr.write = () => { throw new Error('process.stderr.write called'); };

    try {
      delete require.cache[require.resolve('./cost')];
      const result = await require('./cost').compute([]);
      assert.match(result, /Total cost/);
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exit = origExit;
      process.stderr.write = origStderrWrite;
    }
  });

  test('compute() rejects with the pricing-load-failure message when loadPricing fails, and run() prints both lines and exits 1', async () => {
    writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({ _fetched_at: 0, data: {} }));

    const https = require('https');
    const origGet = https.get;
    https.get = (url, cb) => {
      const { EventEmitter } = require('events');
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => req.emit('error', new Error('network unreachable')));
      return req;
    };

    try {
      delete require.cache[require.resolve('./cost')];
      await assert.rejects(
        require('./cost').compute([]),
        { message: 'git turn: could not load pricing data: network unreachable\nCheck your internet connection or try again later.' }
      );

      delete require.cache[require.resolve('./cost')];
      const { err, exitCode } = await captureCostAsync([]);
      assert.equal(exitCode, 1);
      assert.match(err, /git turn: could not load pricing data: network unreachable/);
      assert.match(err, /Check your internet connection or try again later\./);
    } finally {
      https.get = origGet;
    }
  });

  test('compute() on a no-turns session resolves to a string ending "No turns yet this session."', async () => {
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });

    delete require.cache[require.resolve('./cost')];
    const result = await require('./cost').compute([]);
    assert.ok(result.endsWith('No turns yet this session.'));
  });

  // Task 2: --json output

  test('compute(["--json"]) with one priced turn parses to the documented object shape', async () => {
    seedHookNote();
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
    runWithStdin({ model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, output_tokens: 500 } });

    delete require.cache[require.resolve('./cost')];
    const result = JSON.parse(await require('./cost').compute(['--json']));

    assert.deepEqual(
      Object.keys(result).sort(),
      ['model_totals', 'session_id', 'total_cost', 'turns', 'turns_with_cost', 'turns_with_model'].sort()
    );
    assert.equal(result.session_id, session.session_id);
    assert.equal(result.turns.length, 1);

    const turn = result.turns[0];
    assert.deepEqual(
      Object.keys(turn).sort(),
      ['turn', 'session_id', 'model', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cost'].sort()
    );
    assert.equal(turn.turn, 1);
    assert.equal(turn.session_id, session.session_id);
    assert.equal(turn.model, 'claude-sonnet-4-5');
    assert.equal(turn.input_tokens, 1000);
    assert.equal(turn.output_tokens, 500);
    assert.equal(turn.cache_read_input_tokens, null);
    assert.equal(turn.cache_creation_input_tokens, null);
    assert.ok(Math.abs(turn.cost - 0.0105) < 1e-9);

    assert.ok(Math.abs(result.total_cost - 0.0105) < 1e-9);
    assert.equal(result.turns_with_cost, 1);
    assert.equal(result.turns_with_model, 1);
    assert.ok(Math.abs(result.model_totals['claude-sonnet-4-5'] - 0.0105) < 1e-9);
  });

  test('compute(["--json"]) excludes a turn with no model/usage from total_cost and reports null fields', async () => {
    const { makeTurn } = require('../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });

    delete require.cache[require.resolve('./cost')];
    const result = JSON.parse(await require('./cost').compute(['--json']));

    assert.equal(result.turns.length, 1);
    const turn = result.turns[0];
    assert.equal(turn.model, null);
    assert.equal(turn.input_tokens, null);
    assert.equal(turn.output_tokens, null);
    assert.equal(turn.cache_read_input_tokens, null);
    assert.equal(turn.cache_creation_input_tokens, null);
    assert.equal(turn.cost, null);
    assert.equal(result.total_cost, 0);
    assert.equal(result.turns_with_cost, 0);
  });

  test('compute(["--json"]) on a no-turns session parses to the empty-session shape', async () => {
    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });

    delete require.cache[require.resolve('./cost')];
    const result = JSON.parse(await require('./cost').compute(['--json']));

    assert.deepEqual(result, {
      session_id: session.session_id,
      turns: [],
      total_cost: 0,
      turns_with_cost: 0,
      turns_with_model: 0,
      model_totals: {},
    });
  });

  test('run(["--json"]) with no session prints the error object on stdout and exits 1', async () => {
    const { gitDir } = require('../git');
    const { rmSync: rm } = require('fs');
    rm(join(gitDir(), 'git-turn', 'session.json'), { force: true });

    delete require.cache[require.resolve('./cost')];
    const { out, exitCode } = await captureCostAsync(['--json']);

    assert.equal(exitCode, 1);
    assert.deepEqual(JSON.parse(out.join('\n')), {
      error: 'git turn: not initialized. Run `git turn init` first.',
    });
  });
});

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
});

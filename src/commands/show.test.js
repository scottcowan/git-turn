'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');
const { gitSafe, shouldColor, addNote } = require('../git');
const { NOTES_REF } = require('../session');
const { EMPTY_TREE } = require('../diff-render');

describe('show command', () => {
  let dir, origCwd, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    const { startSession } = require('../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  // Monkeypatches fs.readFileSync so fd 0 returns the given payload (an
  // object is JSON.stringify'd, a raw string is passed through verbatim).
  // Also captures console.log/console.error and stubs process.exit to throw
  // a recognizable error so exit codes are assertable without actually
  // killing the test process.
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

  // Captures console.log/console.error for show.js's run(args), stubbing
  // process.exit to throw a recognizable error so exit codes are
  // assertable without actually killing the test process.
  function captureShow(args) {
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;

    const out = [];
    const err = [];
    let exitCode = null;

    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => err.push(a.join(' '));
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./show')];
      require('./show').run(args);
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
      process.exit = origExit;
    }

    return { out, err, exitCode };
  }

  test('VERIFY-01: show <N> --with-prompts renders real captured prompt/model end-to-end', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5', latency_ms: 4200 });
    const { out } = captureShow(['1', '--with-prompts']);
    const combined = out.join('\n');
    assert.match(combined, /why did this break/);
    assert.match(combined, /claude-sonnet-4-5/);
  });

  test('VERIFY-01: show <N> without --with-prompts prints model/latency but not the prompt body', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5', latency_ms: 4200 });
    const { out } = captureShow(['1']);
    const combined = out.join('\n');
    assert.match(combined, /claude-sonnet-4-5/);
    assert.ok(!combined.includes('why did this break'));
  });

  test('show <N> nonexistent turn writes not-found error and exits 1', () => {
    seedHookNote();
    const { err, exitCode } = captureShow(['99']);
    assert.equal(exitCode, 1);
    assert.match(err.join('\n'), /turn 99 not found/);
  });

  test('show <N> --with-prompts no longer prints the stale no-note-found error', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    const { err } = captureShow(['1', '--with-prompts']);
    assert.ok(!err.join('\n').includes('no note found'));
  });

  function withEnv(vars, fn) {
    const orig = {};
    for (const k of Object.keys(vars)) {
      orig[k] = process.env[k];
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    try {
      return fn();
    } finally {
      for (const k of Object.keys(vars)) {
        if (orig[k] === undefined) delete process.env[k];
        else process.env[k] = orig[k];
      }
    }
  }

  // Build the exact header-block lines compute()/run() push, matching the
  // pre-refactor console.log sequence verbatim.
  function expectedHeaderLines(turnN, head, meta, withPrompts) {
    const lines = [];
    lines.push(`Turn ${turnN}  ${head.slice(0, 7)}  ${new Date(meta.ts || 0).toLocaleString()}`);
    if (meta.model) lines.push(`Model: ${meta.model}`);
    if (meta.latency_ms) lines.push(`Latency: ${meta.latency_ms}ms`);
    if (withPrompts && meta.prompt) {
      lines.push(`\nPrompt:\n  ${meta.prompt.replace(/\n/g, '\n  ')}`);
    }
    lines.push('');
    return lines;
  }

  test('--plain byte-identical to header + inline gitSafe diff (NO_COLOR, FORCE_COLOR)', () => {
    const { headSha, snapshotSha } = seedHookNote();
    const meta = { session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha, ts: '2026-09-18T00:00:00.000Z', model: 'claude-sonnet-4-5', latency_ms: 4200, prompt: 'why did this break' };
    addNote(NOTES_REF, headSha, JSON.stringify(meta));

    const { compute } = require('./show');

    for (const env of [{ NO_COLOR: '1', FORCE_COLOR: undefined }, { FORCE_COLOR: '1', NO_COLOR: undefined }]) {
      withEnv(env, () => {
        const colorArg = shouldColor() ? '--color=always' : '--color=never';
        const expectedDiff = gitSafe(['diff', colorArg, EMPTY_TREE, snapshotSha]) || '(no changes)';
        const expected = [...expectedHeaderLines(1, headSha, meta, true), expectedDiff].join('\n');
        assert.equal(compute(['1', '--with-prompts', '--plain']), expected);
      });
    }
  });

  test('rich default under NO_COLOR renders header then Added/removed line, no ANSI', () => {
    const { headSha, snapshotSha } = seedHookNote();
    const meta = { session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha, ts: '2026-09-18T00:00:00.000Z', model: 'claude-sonnet-4-5' };
    addNote(NOTES_REF, headSha, JSON.stringify(meta));

    const { compute } = require('./show');

    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      const output = compute(['1']);
      const headerLines = expectedHeaderLines(1, headSha, meta, false);
      const outLines = output.split('\n');
      assert.deepEqual(outLines.slice(0, headerLines.length), headerLines);
      assert.match(outLines[headerLines.length], /^Added \d+ \/ removed 0$/);
      assert.doesNotMatch(output, /\x1b/);
    });
  });

  test('rich default under FORCE_COLOR contains the added-row background escape', () => {
    const { headSha, snapshotSha } = seedHookNote();
    addNote(NOTES_REF, headSha, JSON.stringify({ session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha, ts: '2026-09-18T00:00:00.000Z' }));

    const { compute } = require('./show');

    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const output = compute(['1']);
      assert.match(output, /\x1b\[48;5;22m/);
    });
  });

  test('--json includes metadata, raw diff and counts, no prompt without --with-prompts', () => {
    const { headSha, snapshotSha } = seedHookNote();
    const meta = { session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha, ts: '2026-09-18T00:00:00.000Z', model: 'claude-sonnet-4-5', latency_ms: 4200, usage: { input_tokens: 10, output_tokens: 20 }, tool_summary: { Read: 1 }, prompt: 'why did this break' };
    addNote(NOTES_REF, headSha, JSON.stringify(meta));

    const { compute } = require('./show');

    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const parsed = JSON.parse(compute(['1', '--json']));
      assert.equal(parsed.turn, 1);
      assert.equal(parsed.sha, headSha);
      assert.equal(parsed.snapshot_sha, snapshotSha);
      assert.equal(parsed.ts, meta.ts);
      assert.equal(parsed.model, meta.model);
      assert.equal(parsed.latency_ms, meta.latency_ms);
      assert.deepEqual(parsed.usage, meta.usage);
      assert.deepEqual(parsed.tool_summary, meta.tool_summary);
      assert.equal(parsed.from_sha, EMPTY_TREE);
      assert.equal(parsed.to_sha, snapshotSha);
      assert.match(parsed.diff, /diff --git/);
      assert.doesNotMatch(parsed.diff, /\x1b/);
      assert.ok(typeof parsed.added === 'number');
      assert.ok(typeof parsed.removed === 'number');
      assert.ok(!('prompt' in parsed));
    });
  });

  test('--json --with-prompts includes the full recorded prompt; absent fields are null', () => {
    const { headSha, snapshotSha } = seedHookNote();
    addNote(NOTES_REF, headSha, JSON.stringify({ session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha, prompt: 'why did this break' }));

    const { compute } = require('./show');
    const parsed = JSON.parse(compute(['1', '--json', '--with-prompts']));
    assert.equal(parsed.prompt, 'why did this break');
    assert.equal(parsed.ts, null);
    assert.equal(parsed.model, null);
    assert.equal(parsed.latency_ms, null);
    assert.equal(parsed.usage, null);
    assert.equal(parsed.tool_summary, null);
  });

  test('compute throws Usage error for non-numeric arg', () => {
    seedHookNote();
    const { compute } = require('./show');
    assert.throws(() => compute(['x']), { message: 'Usage: git turn show <N>' });
  });

  test('compute throws not-found error for missing turn', () => {
    seedHookNote();
    const { compute } = require('./show');
    assert.throws(() => compute(['99']), { message: 'git turn: turn 99 not found' });
  });

  test('compute throws not-initialized error (exact, no suffix) when no session exists', () => {
    const { rmSync: rm } = require('fs');
    const { join } = require('path');
    rm(join(dir, '.git', 'git-turn', 'session.json'), { force: true });
    const { compute } = require('./show');
    assert.throws(() => compute(['1']), { message: 'git turn: not initialized' });
  });

  test('run with --json on not-found prints only the JSON error and exits 1', () => {
    seedHookNote();
    const { out, err, exitCode } = captureShow(['99', '--json']);
    assert.equal(exitCode, 1);
    assert.deepEqual(out, ['{"error":"git turn: turn 99 not found"}']);
    assert.deepEqual(err, []);
  });

  test('Test A: tool_summary renders as "Tool summary: Read:2, Edit:1" in plain-text output', () => {
    const { headSha, snapshotSha } = seedHookNote();
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z', tool_summary: { Read: 2, Edit: 1 },
    }));
    const { compute } = require('./show');
    const output = compute(['1']);
    assert.match(output, /^Tool summary: Read:2, Edit:1$/m);
  });

  describe('tool_summary delimiter guard (D-10)', () => {
    function summaryLines(ts) {
      const { headSha, snapshotSha } = seedHookNote();
      addNote(NOTES_REF, headSha, JSON.stringify({
        session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
        ts: '2026-09-18T00:00:00.000Z', tool_summary: ts,
      }));
      const { compute } = require('./show');
      return compute(['1']).split('\n').filter(l => l.startsWith('Tool summary:'));
    }

    test('strips : , CR LF from keys', () => {
      assert.deepEqual(summaryLines({ 'Bash: x,y': 3 }), ['Tool summary: Bash xy:3']);
    });

    test('newline in key cannot inject a line', () => {
      assert.deepEqual(summaryLines({ 'Re\nad': 1 }), ['Tool summary: Read:1']);
    });

    test('skips non-primitive values', () => {
      assert.deepEqual(summaryLines({ Read: { nested: 1 }, Edit: 2, A: true, B: null, C: [1] }), ['Tool summary: Edit:2']);
    });

    test('no line when every entry is skipped', () => {
      assert.deepEqual(summaryLines({ Read: { n: 1 } }), []);
    });
  });

  test('Test B: no tool_summary field -> no "Tool summary:" line', () => {
    const { headSha, snapshotSha } = seedHookNote();
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
    }));
    const { compute } = require('./show');
    const output = compute(['1']);
    assert.ok(!output.includes('Tool summary:'));
  });

  test('Test C: empty tool_summary object -> no "Tool summary:" line', () => {
    const { headSha, snapshotSha } = seedHookNote();
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z', tool_summary: {},
    }));
    const { compute } = require('./show');
    const output = compute(['1']);
    assert.ok(!output.includes('Tool summary:'));
  });

  test('Test D: opts.color false suppresses ANSI on rich branch under FORCE_COLOR', () => {
    const { headSha } = seedHookNote();
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const { compute } = require('./show');
      const output = compute(['1'], { color: false });
      assert.doesNotMatch(output, /\x1b\[/);
    });
  });

  test('Test E: opts.color false suppresses ANSI on --plain branch under FORCE_COLOR', () => {
    const { headSha } = seedHookNote();
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const { compute } = require('./show');
      const output = compute(['1', '--plain'], { color: false });
      assert.doesNotMatch(output, /\x1b\[/);
    });
  });

  test('Test F (regression guard T-09-01): no opts.color under FORCE_COLOR still colors', () => {
    const { headSha } = seedHookNote();
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const { compute } = require('./show');
      const output = compute(['1']);
      assert.match(output, /\x1b\[/);
    });
  });

  test('Test G: opts.color true forces ANSI even under NO_COLOR', () => {
    const { headSha } = seedHookNote();
    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      const { compute } = require('./show');
      const output = compute(['1'], { color: true });
      assert.match(output, /\x1b\[/);
    });
  });

  test('Test H: --json output unchanged — tool_summary deep-equals note data', () => {
    const { headSha, snapshotSha } = seedHookNote();
    const toolSummary = { Read: 2, Edit: 1 };
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id, turn_n: 1, snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z', tool_summary: toolSummary,
    }));
    const { compute } = require('./show');
    const parsed = JSON.parse(compute(['1', '--json']));
    assert.deepEqual(parsed.tool_summary, toolSummary);
  });
});

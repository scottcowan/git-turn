'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const Module = require('module');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const { rmSync, readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const { realpathSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

const BIN_PATH = join(__dirname, '..', '..', 'bin', 'git-turn');
// Generous enough to tolerate contention when the full suite runs many
// test files concurrently (each spawning real subprocesses) — the actual
// operations here complete in well under 1s in isolation.
const SPAWN_TIMEOUT_MS = 20000;

// Wraps a promise so a hung child can never hang the suite — kills the
// child with SIGKILL and rejects instead of waiting forever.
function withTimeout(promise, child, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`${label} timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function spawnMcp(dir, extraEnv = {}) {
  const child = spawn(process.execPath, [BIN_PATH, 'mcp'], {
    cwd: dir,
    env: { ...process.env, HOME: dir, NO_COLOR: '1', ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  const pendingLines = [];
  const lineWaiters = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.trim() === '') continue;
      if (lineWaiters.length > 0) {
        lineWaiters.shift()(line);
      } else {
        pendingLines.push(line);
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderrBuf += chunk; });

  const exitedPromise = new Promise(resolve => {
    child.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  function nextMessage() {
    return withTimeout(new Promise(resolve => {
      if (pendingLines.length > 0) {
        resolve(pendingLines.shift());
        return;
      }
      lineWaiters.push(resolve);
    }).then(line => JSON.parse(line)), child, 'nextMessage()');
  }

  // Created eagerly here (not lazily on first await), so the 5s timer
  // starts at spawn time — callers that don't reach `await handle.exited`
  // until later (e.g. after a handshake) must not trip Node's
  // unhandledRejection detector in that gap. Attaching a silencing no-op
  // .catch() immediately marks the promise "handled" for that detector
  // while leaving the original promise's resolution/rejection intact for
  // every real caller that awaits `exited` itself.
  const exited = withTimeout(exitedPromise, child, 'exit event');
  exited.catch(() => {});

  return {
    child,
    stdout: () => stdoutBuf,
    stderr: () => stderrBuf,
    nextMessage,
    exited,
  };
}

describe('git turn mcp (MCP-01/02/03)', () => {
  let dir, origCwd, origHome, liveHandle, repo;

  // Tracks the handle spawned by the current test so afterEach can always
  // reap it — a test that throws before reaching its own kill/finally must
  // never leave an orphaned child with open stdio pipes, which would keep
  // this process's event loop alive and hang the whole suite (not just the
  // one test).
  function trackedSpawnMcp(d, extraEnv) {
    liveHandle = spawnMcp(d, extraEnv);
    return liveHandle;
  }

  // Sends initialize (same params as the existing handshake test), awaits
  // the response, then sends notifications/initialized. Callers still need
  // their own id-2+ requests via request().
  async function handshake(handle) {
    handle.child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2026-07-28',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    }) + '\n');
    const response = await handle.nextMessage();
    handle.child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n');
    return response;
  }

  // Writes a JSON-RPC request frame and awaits the response with that id,
  // skipping any message with a different id (e.g. server notifications).
  async function request(handle, id, method, params) {
    handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (;;) {
      const msg = await handle.nextMessage();
      if (msg.id === id) return msg;
    }
  }

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    liveHandle = null;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;
  });

  afterEach(async () => {
    if (liveHandle && liveHandle.child.exitCode === null && liveHandle.child.signalCode === null) {
      try { liveHandle.child.kill('SIGKILL'); } catch {}
    }
    if (liveHandle) {
      try { liveHandle.child.stdout.destroy(); } catch {}
      try { liveHandle.child.stderr.destroy(); } catch {}
      try { liveHandle.child.stdin.destroy(); } catch {}
      await liveHandle.exited.catch(() => {});
    }
    liveHandle = null;
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  test('uninitialized repo fails loudly (MCP-02, D-03)', async () => {
    const handle = trackedSpawnMcp(dir);
    handle.child.stdin.end();

    const { code, signal } = await handle.exited;

    assert.equal(code, 1);
    assert.equal(signal, null);
    assert.equal(handle.stdout(), '');
    assert.equal(handle.stderr().trim(), 'git turn: not initialized. Run `git turn init` first.');
  });

  test('handshake completes and returns git-turn serverInfo (MCP-01)', async () => {
    require('../helpers/turn-fixtures').startSession();

    const handle = trackedSpawnMcp(dir);
    try {
      handle.child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }) + '\n');

      const response = await handle.nextMessage();
      assert.equal(response.jsonrpc, '2.0');
      assert.equal(response.id, 1);
      assert.equal(response.result.serverInfo.name, 'git-turn');

      handle.child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }) + '\n');
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('D-01: stderr carries exactly one startup line scoped to the repo path', async () => {
    require('../helpers/turn-fixtures').startSession();

    const handle = trackedSpawnMcp(dir);
    try {
      handle.child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }) + '\n');
      await handle.nextMessage();

      await new Promise(resolve => setTimeout(resolve, 200));

      const expectedPath = realpathSync(dir);
      const stderrLines = handle.stderr().trim().split('\n').filter(l => l.trim() !== '');
      assert.equal(stderrLines.length, 1);
      assert.equal(stderrLines[0], `git turn mcp: server started, scoped to ${expectedPath}`);
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('stays alive while stdin open, exits cleanly on stdin close (MCP-03, D-02)', async () => {
    require('../helpers/turn-fixtures').startSession();

    const handle = trackedSpawnMcp(dir);
    handle.child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    }) + '\n');
    await handle.nextMessage();
    handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(handle.child.exitCode, null);

    handle.child.stdin.end();

    const { code, signal } = await handle.exited;
    assert.equal(code, 0);
    assert.equal(signal, null);

    const expectedPath = realpathSync(dir);
    assert.equal(handle.stderr().trim(), `git turn mcp: server started, scoped to ${expectedPath}`);

    for (const line of handle.stdout().split('\n')) {
      if (line.trim() === '') continue;
      const parsed = JSON.parse(line);
      assert.equal(parsed.jsonrpc, '2.0');
    }
  });

  test('exits cleanly on SIGINT (MCP-03, D-02)', async () => {
    require('../helpers/turn-fixtures').startSession();

    const handle = trackedSpawnMcp(dir);
    handle.child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    }) + '\n');
    await handle.nextMessage();

    handle.child.kill('SIGINT');

    const { code, signal } = await handle.exited;
    assert.equal(code, 0);
    assert.equal(signal, null);

    const expectedPath = realpathSync(dir);
    assert.equal(handle.stderr().trim(), `git turn mcp: server started, scoped to ${expectedPath}`);
  });

  test('process.exit only in allowed locations (Pitfall 3)', () => {
    const mcpSrc = readFileSync(join(__dirname, 'mcp.js'), 'utf8');
    const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const stripped = strip(mcpSrc);

    assert.ok(stripped.indexOf('serveStdio(') !== -1, 'serveStdio( must appear in mcp.js');
    assert.equal((stripped.match(/process\.exit\(/g) || []).length, 3);
    assert.equal((stripped.match(/process\.exit\(1\)/g) || []).length, 2);
    assert.equal((stripped.match(/process\.exit\(0\)/g) || []).length, 1);

    const timeoutIdx = stripped.indexOf('setTimeout(');
    const exit0Idx = stripped.indexOf('process.exit(0)');
    assert.ok(timeoutIdx !== -1 && exit0Idx > timeoutIdx, 'exit(0) must be inside setTimeout');
    const timeoutCall = stripped.slice(timeoutIdx, stripped.indexOf(';', exit0Idx));
    assert.ok(timeoutCall.includes('SHUTDOWN_TIMEOUT_MS'));

    const finIdx = stripped.indexOf('.finally(');
    const finBody = stripped.slice(finIdx, stripped.indexOf('});', finIdx));
    assert.equal(finBody.includes('process.exit'), false);

    const serverSrc = strip(readFileSync(join(__dirname, '..', 'mcp', 'server.js'), 'utf8'));
    assert.equal(serverSrc.includes('process.exit'), false);
    assert.equal(serverSrc.includes('process.on'), false);
  });

  describe('in-process startup/shutdown (D-04, D-05)', () => {
    const mcpPath = require.resolve('./mcp');
    let exitCalls, stderrChunks, stdoutChunks, sigint, timerState;

    function loadMcpWithFakeServe(fake) {
      const origLoad = Module._load;
      Module._load = function (request, ...rest) {
        if (request === '@modelcontextprotocol/server/stdio') return { serveStdio: fake };
        return origLoad.call(this, request, ...rest);
      };
      try {
        delete require.cache[mcpPath];
        return require('./mcp');
      } finally {
        Module._load = origLoad;
      }
    }

    beforeEach(() => {
      exitCalls = []; stderrChunks = []; stdoutChunks = []; sigint = null; timerState = null;
      require('../helpers/turn-fixtures').startSession();
      mock.method(process, 'exit', (c) => { exitCalls.push(c); });
      mock.method(process.stderr, 'write', (c) => { stderrChunks.push(String(c)); return true; });
      mock.method(process.stdout, 'write', (c) => { stdoutChunks.push(String(c)); return true; });
      mock.method(process, 'once', (ev, fn) => { if (ev === 'SIGINT') sigint = fn; return process; });
      mock.method(global, 'setTimeout', (cb, ms) => {
        timerState = { cb, ms, cleared: false };
        return { unref() {}, ref() {}, _s: timerState };
      });
      mock.method(global, 'clearTimeout', (t) => { if (t && t._s) t._s.cleared = true; });
    });

    afterEach(() => {
      mock.restoreAll();
      delete require.cache[mcpPath];
    });

    test('serveStdio throw: git turn: <message>, exit 1, no startup line (D-05)', () => {
      const { run } = loadMcpWithFakeServe(() => { throw new Error('boom'); });
      run([]);
      assert.deepEqual(exitCalls, [1]);
      assert.deepEqual(stderrChunks, ['git turn: boom\n']);
      assert.deepEqual(stdoutChunks, []);
    });

    test('hung close force-exits 0 via unref timer at 2000ms (D-04)', () => {
      const { run } = loadMcpWithFakeServe(() => ({ close: () => new Promise(() => {}) }));
      run([]);
      sigint();
      assert.equal(timerState.ms, 2000);
      assert.deepEqual(exitCalls, []);
      timerState.cb();
      assert.deepEqual(exitCalls, [0]);
    });

    test('normal close clears timer and destroys stdin, no exit (D-04)', async () => {
      const { run } = loadMcpWithFakeServe(() => ({ close: () => Promise.resolve() }));
      const destroy = mock.method(process.stdin, 'destroy', () => {});
      run([]);
      sigint();
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
      assert.equal(destroy.mock.callCount(), 1);
      assert.equal(timerState.cleared, true);
      assert.deepEqual(exitCalls, []);
    });
  });

  test('help text has no "(no tools yet)" on the mcp line (D-06)', () => {
    const r = spawnSync(process.execPath, [BIN_PATH, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\s+mcp\s+Start a stdio MCP server scoped to the current repo\s*$/m);
    assert.equal(r.stdout.includes('no tools yet'), false);
  });

  test('cwd captured exactly once (MCP-02)', () => {
    const mcpSrc = readFileSync(join(__dirname, 'mcp.js'), 'utf8');
    const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const stripped = strip(mcpSrc);

    const matches = stripped.match(/process\.cwd\(\)/g) || [];
    assert.equal(matches.length, 1);

    const serverSrc = strip(readFileSync(join(__dirname, '..', 'mcp', 'server.js'), 'utf8'));
    assert.equal((serverSrc.match(/process\.cwd\(\)/g) || []).length, 0);
  });

  test('tools/list returns all 5 registered tools with valid schemas (MCP-04..08)', async () => {
    require('../helpers/turn-fixtures').startSession();

    const handle = trackedSpawnMcp(dir);
    try {
      await handshake(handle);
      const response = await request(handle, 2, 'tools/list', {});

      const names = response.result.tools.map(t => t.name).sort();
      assert.deepEqual(names, ['git_turn_blame', 'git_turn_cost', 'git_turn_diff', 'git_turn_log', 'git_turn_show']);

      for (const tool of response.result.tools) {
        assert.equal(tool.inputSchema.type, 'object');
        const props = tool.inputSchema.properties || {};
        for (const key of Object.keys(props)) {
          const desc = props[key].description || '';
          assert.ok(desc.toLowerCase().includes(key.toLowerCase()) || desc.length > 0, `${tool.name}.${key} should have a non-empty description`);
        }
      }

      const show = response.result.tools.find(t => t.name === 'git_turn_show');
      assert.ok((show.inputSchema.required || []).includes('turn'));
      const diff = response.result.tools.find(t => t.name === 'git_turn_diff');
      assert.ok((diff.inputSchema.required || []).includes('turn'));
      const blame = response.result.tools.find(t => t.name === 'git_turn_blame');
      assert.ok((blame.inputSchema.required || []).includes('file'));
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('isError survives and server stays alive for the next call (MCP-09)', async () => {
    const session = require('../helpers/turn-fixtures').startSession();
    require('../helpers/turn-fixtures').makeTurn(session, 'a', repo.git);

    const handle = trackedSpawnMcp(dir);
    try {
      await handshake(handle);

      const badShow = await request(handle, 2, 'tools/call', { name: 'git_turn_show', arguments: { turn: 999 } });
      assert.equal(badShow.result.isError, true);
      assert.equal(badShow.result.content[0].text, 'git turn: turn 999 not found');
      assert.equal(handle.child.exitCode, null);

      const log = await request(handle, 3, 'tools/call', { name: 'git_turn_log', arguments: {} });
      assert.notEqual(log.result.isError, true);
      assert.ok(log.result.content[0].text.includes('Session:'));
      assert.equal(handle.child.exitCode, null);
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('invalid args still answer and the server survives for a following tools/list', async () => {
    const session = require('../helpers/turn-fixtures').startSession();
    require('../helpers/turn-fixtures').makeTurn(session, 'a', repo.git);

    const handle = trackedSpawnMcp(dir);
    try {
      await handshake(handle);

      const bad = await request(handle, 2, 'tools/call', { name: 'git_turn_show', arguments: { turn: 'abc' } });
      assert.ok(bad.error || bad.result?.isError === true);

      const list = await request(handle, 3, 'tools/list', {});
      assert.equal(list.result.tools.length, 5);
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('FORCE_COLOR=1 does not leak ANSI into show/diff tool output (MCP-10, D-02)', async () => {
    const session = require('../helpers/turn-fixtures').startSession();
    require('../helpers/turn-fixtures').makeTurn(session, 'a', repo.git);

    const handle = trackedSpawnMcp(dir, { NO_COLOR: '', FORCE_COLOR: '1' });
    try {
      await handshake(handle);

      const show = await request(handle, 2, 'tools/call', { name: 'git_turn_show', arguments: { turn: 1 } });
      assert.notEqual(show.result.isError, true);
      assert.equal(show.result.content[0].text.includes('\x1b['), false);

      const diff = await request(handle, 3, 'tools/call', { name: 'git_turn_diff', arguments: { turn: 1 } });
      assert.notEqual(diff.result.isError, true);
      assert.equal(diff.result.content[0].text.includes('\x1b['), false);
    } finally {
      handle.child.kill('SIGKILL');
      await handle.exited.catch(() => {});
    }
  });

  test('src/mcp/tools files never call process.exit or .run(, and always route through commands/', () => {
    const toolsDir = join(__dirname, '..', 'mcp', 'tools');
    const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const files = readdirSync(toolsDir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'));
    assert.ok(files.length >= 5);
    for (const file of files) {
      const src = strip(readFileSync(join(toolsDir, file), 'utf8'));
      assert.equal(src.includes('process.exit'), false, `${file} must not call process.exit`);
      assert.equal(src.includes('.run('), false, `${file} must not call .run(`);
      assert.ok(src.includes("require('../../commands/"), `${file} must require a command module`);
    }
  });
});

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { rmSync, readFileSync } = require('fs');
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

function spawnMcp(dir) {
  const child = spawn(process.execPath, [BIN_PATH, 'mcp'], {
    cwd: dir,
    env: { ...process.env, HOME: dir, NO_COLOR: '1' },
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
  let dir, origCwd, origHome, liveHandle;

  // Tracks the handle spawned by the current test so afterEach can always
  // reap it — a test that throws before reaching its own kill/finally must
  // never leave an orphaned child with open stdio pipes, which would keep
  // this process's event loop alive and hang the whole suite (not just the
  // one test).
  function trackedSpawnMcp(d) {
    liveHandle = spawnMcp(d);
    return liveHandle;
  }

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    liveHandle = null;
    const repo = makeTestRepo();
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

  test('no process.exit reachable after serveStdio (Pitfall 3)', () => {
    const mcpSrc = readFileSync(join(__dirname, 'mcp.js'), 'utf8');
    const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const stripped = strip(mcpSrc);

    const lastExitIdx = stripped.lastIndexOf('process.exit');
    const serveStdioIdx = stripped.indexOf('serveStdio(');
    assert.ok(serveStdioIdx !== -1, 'serveStdio( must appear in mcp.js');
    assert.ok(lastExitIdx < serveStdioIdx, 'last process.exit must precede serveStdio(');

    const serverSrc = strip(readFileSync(join(__dirname, '..', 'mcp', 'server.js'), 'utf8'));
    assert.equal(serverSrc.includes('process.exit'), false);
    assert.equal(serverSrc.includes('process.on'), false);
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
});

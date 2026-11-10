'use strict';

// This command exports only `run` (no `compute()`) — a deliberate exception
// to the Phase 7 compute/run split: there is nothing to compute, the
// long-lived server itself is the work.

const { readSession } = require('../session');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { createServer } = require('../mcp/server');

const SHUTDOWN_TIMEOUT_MS = 2000;

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
    return;
  }

  // Captured ONCE, before the server starts. Tool handlers do not receive
  // repoPath: they rely on the process cwd never changing (git subprocesses
  // resolve the repo from it). repoPath is used only for the startup stderr
  // line below.
  const repoPath = process.cwd();

  let handle;
  try {
    handle = serveStdio(createServer);
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    process.stderr.write(`git turn: ${message}\n`);
    process.exit(1);
    return;
  }

  process.stderr.write(`git turn mcp: server started, scoped to ${repoPath}\n`); // D-01

  // Exit code stays 0 on force-exit (D-04, AGENTS.md contract).
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    handle.close().catch(() => {}).finally(() => {
      clearTimeout(forceExit);
      process.stdin.destroy();
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = { run };

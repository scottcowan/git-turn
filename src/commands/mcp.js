'use strict';

// This command exports only `run` (no `compute()`) — a deliberate exception
// to the Phase 7 compute/run split: there is nothing to compute, the
// long-lived server itself is the work.

const { readSession } = require('../session');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { createServer } = require('../mcp/server');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
    return;
  }

  // Captured ONCE, before the server starts — never re-read per tool call
  // (MCP-02). Phase 9 tool handlers must receive this value, not re-call
  // process.cwd().
  const repoPath = process.cwd();

  const handle = serveStdio(createServer);

  process.stderr.write(`git turn mcp: server started, scoped to ${repoPath}\n`); // D-01

  process.once('SIGINT', () => {
    handle.close().catch(() => {}).finally(() => {
      process.stdin.destroy();
    });
  });
}

module.exports = { run };

'use strict';

const { McpServer } = require('@modelcontextprotocol/server');

// Zero tools registered this phase (Phase 8 scope). Phase 9 adds
// server.registerTool(...) calls here.
function createServer() {
  return new McpServer({
    name: 'git-turn',
    version: require('../../package.json').version,
  });
}

module.exports = { createServer };

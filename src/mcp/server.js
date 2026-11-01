'use strict';

const { McpServer } = require('@modelcontextprotocol/server');
const log = require('./tools/log');
const show = require('./tools/show');
const diff = require('./tools/diff');
const blame = require('./tools/blame');
const cost = require('./tools/cost');

// Registers the 5 read-only tools (log/show/diff/blame/cost). No
// write/destructive tools (revert/bisect/redact/record-prompt) are
// registered — intentionally absent this milestone.
function createServer() {
  const server = new McpServer({
    name: 'git-turn',
    version: require('../../package.json').version,
  });
  log.register(server);
  show.register(server);
  diff.register(server);
  blame.register(server);
  cost.register(server);
  return server;
}

module.exports = { createServer };

'use strict';

const { z } = require('zod');
const { compute } = require('../../commands/cost');

async function handler({ all, noCache } = {}) {
  const argv = [all && '--all', noCache && '--no-cache'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: await compute(argv) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_cost',
    {
      description: 'Token usage and cost for the current session (mirrors `git turn cost`). Params: all, noCache.',
      inputSchema: z.object({
        all: z.boolean().optional().describe('Report across all sessions, not just current'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };

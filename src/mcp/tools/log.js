'use strict';

const { z } = require('zod');
const { compute } = require('../../commands/log');

async function handler({ withPrompts, noCache } = {}) {
  const argv = [withPrompts && '--with-prompts', noCache && '--no-cache'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: compute(argv) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_log',
    {
      description: 'List turns in the current session (mirrors `git turn log`). Params: withPrompts, noCache.',
      inputSchema: z.object({
        withPrompts: z.boolean().optional().describe('Include first line of captured prompt per turn'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };

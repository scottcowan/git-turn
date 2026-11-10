'use strict';

const { z } = require('zod');
const { compute } = require('../../commands/show');

async function handler({ turn, withPrompts } = {}) {
  if (!Number.isInteger(turn)) {
    return { content: [{ type: 'text', text: 'git turn: turn is required' }], isError: true };
  }
  const argv = [String(turn), withPrompts && '--with-prompts'].filter(Boolean);
  try {
    return { content: [{ type: 'text', text: compute(argv, { color: false }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_show',
    {
      description: 'Full diff and metadata (model, latency, tool summary) for turn N (mirrors `git turn show <N>`). Params: turn, withPrompts.',
      inputSchema: z.object({
        turn: z.number().int().positive().describe('Turn number to show'),
        withPrompts: z.boolean().optional().describe('Include the captured prompt text if present'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };

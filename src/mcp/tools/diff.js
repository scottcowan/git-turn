'use strict';

const { z } = require('zod');
const { compute } = require('../../commands/diff');

async function handler({ turn, toTurn } = {}) {
  if (!Number.isInteger(turn)) {
    return { content: [{ type: 'text', text: 'git turn: turn is required' }], isError: true };
  }
  if (toTurn !== undefined && !Number.isInteger(toTurn)) {
    return { content: [{ type: 'text', text: 'git turn: toTurn must be a number' }], isError: true };
  }
  const argv = [String(turn), toTurn !== undefined ? String(toTurn) : null].filter(v => v !== null);
  try {
    return { content: [{ type: 'text', text: compute(argv, { color: false }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_diff',
    {
      description: 'Diff turn N-1 vs N, or turn N vs toTurn if given (mirrors `git turn diff <N> [M]`). Params: turn, toTurn (optional).',
      inputSchema: z.object({
        turn: z.number().int().positive().describe('Turn number to diff'),
        toTurn: z.number().int().positive().optional().describe('Optional second turn number — diffs turn against toTurn directly instead of turn-1 vs turn'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };

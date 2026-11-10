'use strict';

const { z } = require('zod');
const { compute } = require('../../commands/blame');

async function handler({ file, noCache } = {}) {
  if (typeof file !== 'string' || file === '') {
    return { content: [{ type: 'text', text: 'git turn: file is required' }], isError: true };
  }
  if (file.startsWith('-')) {
    return { content: [{ type: 'text', text: 'git turn: file must not start with "-"' }], isError: true };
  }
  const argv = [file, noCache && '--no-cache'].filter(Boolean);
  try {
    // blame.js's opts.stderr is a terminal-only duplicate-sha warning sink —
    // no MCP content channel exists for it, so pass a no-op.
    return { content: [{ type: 'text', text: compute(argv, { stderr: () => {} }) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function register(server) {
  server.registerTool(
    'git_turn_blame',
    {
      description: 'Per-line turn attribution for a file (mirrors `git turn blame <file>`). Params: file, noCache.',
      inputSchema: z.object({
        file: z.string().min(1).describe('Path to the file to blame'),
        noCache: z.boolean().optional().describe('Bypass the SQLite read cache'),
      }),
    },
    handler
  );
}

module.exports = { register, handler };

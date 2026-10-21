'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { gitDir, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage, listAllTurns } = require('../blame-util');

const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function pricingCachePath() {
  return path.join(os.homedir(), '.git-turn-pricing.json');
}

function fetchPricing() {
  return new Promise((resolve, reject) => {
    const req = https.get(PRICING_URL, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('pricing fetch timed out')));
    req.on('error', reject);
  });
}

async function loadPricing() {
  const cachePath = pricingCachePath();
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Date.now() - cached._fetched_at < CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {}

  const data = await fetchPricing();
  try {
    fs.writeFileSync(cachePath, JSON.stringify({ _fetched_at: Date.now(), data }));
  } catch {}
  return data;
}

function lookupPrice(pricing, model) {
  if (!model) return null;
  // Try exact match, then strip provider prefixes (eu., us., anthropic.)
  const candidates = [
    model,
    model.replace(/^(eu|us|ap|au)\.(?=anthropic\.)/i, ''),   // us.anthropic.X -> anthropic.X
    `anthropic.${model}`,
  ];
  for (const key of candidates) {
    const entry = pricing[key];
    if (entry && entry.input_cost_per_token != null && entry.output_cost_per_token != null) {
      return {
        input_per_mtok: entry.input_cost_per_token * 1_000_000,
        output_per_mtok: entry.output_cost_per_token * 1_000_000,
        cache_read_per_mtok: (entry.cache_read_input_token_cost || 0) * 1_000_000,
        cache_write_per_mtok: (entry.cache_creation_input_token_cost || 0) * 1_000_000,
      };
    }
  }
  return null;
}

function computeCost(price, usage) {
  if (!price || !usage) return null;
  const input = (usage.input_tokens || 0) * price.input_per_mtok / 1_000_000;
  const output = (usage.output_tokens || 0) * price.output_per_mtok / 1_000_000;
  const cacheRead = (usage.cache_read_input_tokens || 0) * price.cache_read_per_mtok / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * price.cache_write_per_mtok / 1_000_000;
  return input + output + cacheRead + cacheWrite;
}

// Renders one session's turns into plain-text lines + JSON turn entries.
// `entries` is [{ turn_n, head }] where `head` is the commit sha whose note
// to read. Shared by the single-session path and each --all session block.
function renderSession(sessionId, entries, pricing, wantJson) {
  const lines = [];
  const jsonTurns = [];
  let totalCost = 0;
  let turnsWithCost = 0;
  let turnsWithModel = 0;
  const modelTotals = {};

  lines.push(`Session: ${sessionId}\n`);
  lines.push(`  ${'Turn'.padEnd(5)}  ${'Model'.padEnd(30)}  ${'Input'.padStart(8)}  ${'Output'.padStart(8)}  ${'Cost'.padStart(10)}`);
  lines.push(`  ${'-'.repeat(5)}  ${'-'.repeat(30)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(10)}`);

  for (const { turn_n, head } of entries) {
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    const model = meta.model || null;
    const usage = meta.usage || null;

    if (model) turnsWithModel++;

    const price = model ? lookupPrice(pricing, model) : null;
    const cost = computeCost(price, usage);

    const modelDisplay = model ? model.replace(/^(eu|us|ap|au)\.anthropic\./, '') : '(no model recorded)';
    const inputDisplay = usage ? String(usage.input_tokens || 0).padStart(8) : '       ?';
    const outputDisplay = usage ? String(usage.output_tokens || 0).padStart(8) : '       ?';
    const costDisplay = cost !== null ? `$${cost.toFixed(4)}`.padStart(10) : '         ?';

    lines.push(`  ${String(turn_n).padStart(5)}  ${modelDisplay.slice(0, 30).padEnd(30)}  ${inputDisplay}  ${outputDisplay}  ${costDisplay}`);

    if (cost !== null) {
      totalCost += cost;
      turnsWithCost++;
      modelTotals[modelDisplay] = (modelTotals[modelDisplay] || 0) + cost;
    }

    if (wantJson) {
      const numOrNull = (v) => (typeof v === 'number' ? v : null);
      jsonTurns.push({
        turn: turn_n,
        session_id: sessionId,
        model: model,
        input_tokens: usage ? numOrNull(usage.input_tokens) : null,
        output_tokens: usage ? numOrNull(usage.output_tokens) : null,
        cache_read_input_tokens: usage ? numOrNull(usage.cache_read_input_tokens) : null,
        cache_creation_input_tokens: usage ? numOrNull(usage.cache_creation_input_tokens) : null,
        cost: cost,
      });
    }
  }

  lines.push(`\n  ${'-'.repeat(68)}`);

  if (turnsWithCost > 0) {
    lines.push(`  Total cost (${turnsWithCost}/${entries.length} turns): $${totalCost.toFixed(4)}`);
    if (Object.keys(modelTotals).length > 1) {
      for (const [model, cost] of Object.entries(modelTotals)) {
        lines.push(`    ${model}: $${cost.toFixed(4)}`);
      }
    }
  } else if (turnsWithModel === 0) {
    lines.push(`\n  No cost data available.`);
    lines.push(`  Model and token usage are recorded by the Claude Code Stop hook.`);
    lines.push(`  Make sure git-turn-note.js is configured and includes model/usage fields.`);
  } else {
    lines.push(`\n  Models recorded but no token usage data.`);
    lines.push(`  Cost tracking requires token counts — these are not yet available from the Claude Code Stop hook.`);
  }

  return { lines, jsonTurns, totalCost, turnsWithCost, turnsWithModel, modelTotals };
}

async function compute(args, opts = {}) {
  const session = readSession();
  if (!session) {
    throw new Error('git turn: not initialized. Run `git turn init` first.');
  }

  // Parse --all flag to show all sessions, not just current
  const allSessions = args.includes('--all');
  const wantJson = args.includes('--json');

  let pricing;
  if (opts.stderr) opts.stderr('Fetching pricing data...\r');
  try {
    pricing = await loadPricing();
  } catch (e) {
    throw new Error(`git turn: could not load pricing data: ${e.message}\nCheck your internet connection or try again later.`);
  }
  if (opts.stderr) opts.stderr('                        \r');

  if (allSessions) {
    const allTurns = listAllTurns({ noCache: args.includes('--no-cache') });
    if (allTurns.length === 0) {
      if (wantJson) {
        return JSON.stringify({
          session_id: session.session_id,
          turns: [],
          total_cost: 0,
          turns_with_cost: 0,
          turns_with_model: 0,
          model_totals: {},
        });
      }
      return 'No turns yet in any session.';
    }

    const groups = new Map();
    for (const t of allTurns) {
      if (!groups.has(t.session_id)) groups.set(t.session_id, []);
      groups.get(t.session_id).push({ turn_n: t.turn_n, head: t.head_sha || t.snapshot_sha });
    }
    for (const entries of groups.values()) {
      entries.sort((a, b) => a.turn_n - b.turn_n);
    }

    const sessionBlocks = [];
    let grandTotal = 0;
    let grandTurnsWithCost = 0;
    let grandTurnCount = 0;
    const grandModelTotals = {};
    const grandJsonTurns = [];

    for (const [sessionId, entries] of groups) {
      const result = renderSession(sessionId, entries, pricing, wantJson);
      sessionBlocks.push(result);
      grandTotal += result.totalCost;
      grandTurnsWithCost += result.turnsWithCost;
      grandTurnCount += entries.length;
      grandJsonTurns.push(...result.jsonTurns);
      for (const [model, cost] of Object.entries(result.modelTotals)) {
        grandModelTotals[model] = (grandModelTotals[model] || 0) + cost;
      }
    }

    if (wantJson) {
      return JSON.stringify({
        session_id: session.session_id,
        turns: grandJsonTurns,
        total_cost: grandTotal,
        turns_with_cost: grandTurnsWithCost,
        turns_with_model: sessionBlocks.reduce((sum, r) => sum + r.turnsWithModel, 0),
        model_totals: grandModelTotals,
      });
    }

    const n = groups.size;
    const plural = n === 1 ? 'session' : 'sessions';
    const text = sessionBlocks.map(r => r.lines.join('\n')).join('\n\n')
      + `\n\nGrand total across ${n} ${plural} (${grandTurnsWithCost}/${grandTurnCount} turns): $${grandTotal.toFixed(4)}`;
    return text;
  }

  // Collect turns with notes
  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    if (wantJson) {
      return JSON.stringify({
        session_id: session.session_id,
        turns: [],
        total_cost: 0,
        turns_with_cost: 0,
        turns_with_model: 0,
        model_totals: {},
      });
    }
    return 'No turns yet this session.';
  }

  const entries = turns.map(({ turn_n, sha }) => {
    const { headSha } = parseSnapshotMessage(sha);
    return { turn_n, head: headSha || sha };
  });

  const { lines, jsonTurns, totalCost, turnsWithCost, turnsWithModel, modelTotals } =
    renderSession(session.session_id, entries, pricing, wantJson);

  if (wantJson) {
    return JSON.stringify({
      session_id: session.session_id,
      turns: jsonTurns,
      total_cost: totalCost,
      turns_with_cost: turnsWithCost,
      turns_with_model: turnsWithModel,
      model_totals: modelTotals,
    });
  }

  return lines.join('\n');
}

async function run(args) {
  try {
    console.log(await compute(args, { stderr: (s) => process.stderr.write(s) }));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
      return;
    }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute, lookupPrice, computeCost };

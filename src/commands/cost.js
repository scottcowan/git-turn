'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { gitDir, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');

const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function pricingCachePath() {
  return path.join(os.homedir(), '.git-turn-pricing.json');
}

function fetchPricing() {
  return new Promise((resolve, reject) => {
    https.get(PRICING_URL, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
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
    model.replace(/^(eu|us|ap|au)\./i, 'anthropic.'),
    `anthropic.${model}`,
    model,
  ];
  for (const key of candidates) {
    const entry = pricing[key];
    if (entry && entry.input_cost_per_token) {
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

async function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  // Parse --all flag to show all sessions, not just current
  const allSessions = args.includes('--all');

  let pricing;
  try {
    process.stderr.write('Fetching pricing data...\r');
    pricing = await loadPricing();
    process.stderr.write('                        \r');
  } catch (e) {
    console.error(`git turn: could not load pricing data: ${e.message}`);
    console.error('Check your internet connection or try again later.');
    process.exit(1);
  }

  // Collect turns with notes
  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    console.log('No turns yet this session.');
    return;
  }

  let totalCost = 0;
  let turnsWithCost = 0;
  let turnsWithModel = 0;
  const modelTotals = {};

  console.log(`Session: ${session.session_id}\n`);
  console.log(`  ${'Turn'.padEnd(5)}  ${'Model'.padEnd(30)}  ${'Input'.padStart(8)}  ${'Output'.padStart(8)}  ${'Cost'.padStart(10)}`);
  console.log(`  ${'-'.repeat(5)}  ${'-'.repeat(30)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(10)}`);

  for (const { turn_n, sha } of turns) {
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', sha], { stdio: ['pipe', 'pipe', 'ignore'] });
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

    console.log(`  ${String(turn_n).padStart(5)}  ${modelDisplay.slice(0, 30).padEnd(30)}  ${inputDisplay}  ${outputDisplay}  ${costDisplay}`);

    if (cost !== null) {
      totalCost += cost;
      turnsWithCost++;
      modelTotals[modelDisplay] = (modelTotals[modelDisplay] || 0) + cost;
    }
  }

  console.log(`\n  ${'-'.repeat(68)}`);

  if (turnsWithCost > 0) {
    console.log(`  Total cost (${turnsWithCost}/${turns.length} turns): $${totalCost.toFixed(4)}`);
    if (Object.keys(modelTotals).length > 1) {
      for (const [model, cost] of Object.entries(modelTotals)) {
        console.log(`    ${model}: $${cost.toFixed(4)}`);
      }
    }
  } else if (turnsWithModel === 0) {
    console.log(`\n  No cost data available.`);
    console.log(`  Model and token usage are recorded by the Claude Code Stop hook.`);
    console.log(`  Make sure git-turn-note.js is configured and includes model/usage fields.`);
  } else {
    console.log(`\n  Models recorded but no token usage data.`);
    console.log(`  Cost tracking requires token counts — these are not yet available from the Claude Code Stop hook.`);
  }
}

module.exports = { run };

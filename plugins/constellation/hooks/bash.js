'use strict';

const { bashSearch, symbolOf } = require('./classify');
const { absolute, contextOutput, emit, isConfigured, loadState, projectRoot, readInput, saveState } = require('./lib');

const DEFAULT_NUDGE_LIMIT = 3;

/** The per-session nudge limit from CONSTELLATION_NUDGE_LIMIT: a non-negative integer, else the default. */
function nudgeLimit(env = process.env) {
  const raw = env.CONSTELLATION_NUDGE_LIMIT;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_NUDGE_LIMIT;
  return Number(raw.trim());
}

function nudgeText(symbol) {
  return `\`${symbol}\` looks like a symbol. code_intel api.searchSymbols / traceSymbolUsage finds its definition and every usage across files, including ones text search misses. Use text search for literal strings, config values, and logs.`;
}

async function run() {
  if (!isConfigured()) return;

  const input = await readInput();
  if (input.tool_name !== 'Bash') return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || typeof input.cwd !== 'string' || input.cwd === '') return;

  const search = bashSearch(command);
  if (search === null) return;
  const symbol = symbolOf(search.pattern);
  if (symbol === null) return;
  if (projectRoot(absolute(search.path === undefined ? '.' : search.path, input.cwd)) === null) return;

  const agentKey = typeof input.agent_id === 'string' && input.agent_id !== '' ? input.agent_id : 'main';
  const state = loadState(input.session_id);
  const codeIntelTurn = state.codeIntelTurn || {};
  const nudges = state.nudges || {};
  if (typeof input.turn_id === 'string' && codeIntelTurn[agentKey] === input.turn_id) return;
  const sent = nudges[agentKey] || 0;
  if (sent >= nudgeLimit()) return;

  saveState(input.session_id, { ...state, nudges: { ...nudges, [agentKey]: sent + 1 } });
  emit(contextOutput('PostToolUse', nudgeText(symbol)));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  nudgeLimit,
  run,
};

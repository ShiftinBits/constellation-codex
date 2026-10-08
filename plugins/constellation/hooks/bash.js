'use strict';

const { bashSearch, symbolOf } = require('./classify');
const { freshnessNotice } = require('./freshness');
const { absolute, contextOutput, emit, hasIndexedChild, isConfigured, loadState, projectRoot, readInput, saveState } = require('./lib');

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

  const state = loadState(input.session_id);
  const notice = freshnessNotice(command, input.cwd, state);
  const base = notice === null ? state : notice.state;
  const nudge = nudgeFor(command, input, base);

  const next = nudge === null ? base : nudge.state;
  if (next !== state) saveState(input.session_id, next, state);

  const text = [notice && notice.context, nudge && nudge.text].filter(Boolean).join('\n\n');
  if (text === '' && !(notice && notice.systemMessage)) return;
  const output = text === '' ? {} : contextOutput('PostToolUse', text);
  if (notice && notice.systemMessage) output.systemMessage = notice.systemMessage;
  emit(output);
}

/** The search nudge for `command` and the session state it leaves, or null when no nudge applies. */
function nudgeFor(command, input, state) {
  const search = bashSearch(command);
  if (search === null) return null;
  const symbol = symbolOf(search.pattern);
  if (symbol === null) return null;
  // Codex reports the session cwd, not the command's workdir, so a session started above indexed projects counts too.
  const target = absolute(search.path === undefined ? '.' : search.path, input.cwd);
  if (projectRoot(target) === null && !hasIndexedChild(target)) return null;

  const agentKey = typeof input.agent_id === 'string' && input.agent_id !== '' ? input.agent_id : 'main';
  const codeIntelTurn = state.codeIntelTurn || {};
  const nudges = state.nudges || {};
  if (typeof input.turn_id === 'string' && codeIntelTurn[agentKey] === input.turn_id) return null;
  const sent = nudges[agentKey] || 0;
  if (sent >= nudgeLimit()) return null;

  return { text: nudgeText(symbol), state: { ...state, nudges: { ...nudges, [agentKey]: sent + 1 } } };
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  nudgeLimit,
  run,
};

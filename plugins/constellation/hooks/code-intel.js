'use strict';

const { isConfigured, loadState, readInput, saveState } = require('./lib');

/** Records that the agent used code_intel in the current turn, which silences the search nudge for that turn. */
async function run() {
  if (!isConfigured()) return;

  const input = await readInput();
  if (typeof input.turn_id !== 'string' || input.turn_id === '') return;

  const agentKey = typeof input.agent_id === 'string' && input.agent_id !== '' ? input.agent_id : 'main';
  const state = loadState(input.session_id);
  saveState(input.session_id, { ...state, codeIntelTurn: { ...(state.codeIntelTurn || {}), [agentKey]: input.turn_id } });
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  run,
};

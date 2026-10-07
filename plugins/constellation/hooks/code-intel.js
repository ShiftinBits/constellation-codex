'use strict';

const { COMMIT, envelopeOf } = require('./freshness');
const { isConfigured, loadState, projectRoot, readInput, saveState } = require('./lib');

/**
 * Records that the agent used code_intel in the current turn, which silences the search nudge for that turn,
 * and the commit the index reflects for the project, which the freshness check compares HEAD against.
 */
async function run() {
  if (!isConfigured()) return;

  const input = await readInput();
  const agentKey = typeof input.agent_id === 'string' && input.agent_id !== '' ? input.agent_id : 'main';
  const state = loadState(input.session_id);
  let next = state;

  if (typeof input.turn_id === 'string' && input.turn_id !== '') {
    next = { ...next, codeIntelTurn: { ...(state.codeIntelTurn || {}), [agentKey]: input.turn_id } };
  }

  const envelope = envelopeOf(input.tool_response);
  const root = typeof input.cwd === 'string' ? projectRoot(input.cwd) : null;
  if (envelope !== null && root !== null && typeof envelope.asOfCommit === 'string' && COMMIT.test(envelope.asOfCommit)) {
    const entry = { asOfCommit: envelope.asOfCommit };
    if (envelope.lastIndexedAt !== undefined) entry.lastIndexedAt = envelope.lastIndexedAt;
    next = { ...next, index: { ...(state.index || {}), [root]: entry } };
  }

  if (next !== state) saveState(input.session_id, next);
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  run,
};

'use strict';

const { contextOutput, emit, isConfigured, readInput } = require('./lib');

const TOOL_USE_REMINDER =
  'This looks like text search. If you are looking for symbols, references, callers, dependencies, or impact, use code_intel. If you need exact strings, config values, logs, or raw file contents, local search is appropriate.';
const TRIGGER_REGEX = /\b(?:grep|rg|glob|awk|findstr)\b/i;

async function run() {
  if (!isConfigured()) return;

  const input = await readInput();
  if (input.tool_name !== 'Bash') return;

  const command = input.tool_input?.command || '';
  if (!command || !TRIGGER_REGEX.test(command)) return;

  emit(contextOutput('PreToolUse', TOOL_USE_REMINDER));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  run,
};

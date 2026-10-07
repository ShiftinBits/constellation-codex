'use strict';

const { contextOutput, emit, isConfigured, readInput } = require('./lib');

const SESSION_START_REMINDER =
  'Use code_intel for structural code questions: definitions, references, callers, dependencies, impact, architecture, and orphaned code. Use local file/text tools for exact strings, config values, logs, docs, file contents, or unindexed projects.';
const TOOL_USE_REMINDER =
  'This looks like text search. If you are looking for symbols, references, callers, dependencies, or impact, use code_intel. If you need exact strings, config values, logs, or raw file contents, local search is appropriate.';

const ADDITIONAL_CONTEXT = {
  SessionStart: SESSION_START_REMINDER,
  PreToolUse: TOOL_USE_REMINDER,
  PostToolUse: TOOL_USE_REMINDER,
};

function buildHookOutput(hookEventName) {
  const additionalContext = ADDITIONAL_CONTEXT[hookEventName];
  if (!additionalContext) return null;
  return contextOutput(hookEventName, additionalContext);
}

async function run(argvEvent) {
  if (!isConfigured()) return;
  const input = await readInput();
  const hookEventName = input.hook_event_name || argvEvent;
  emit(buildHookOutput(hookEventName));
}

if (require.main === module) {
  run(process.argv[2]).catch(() => {});
}

module.exports = {
  ADDITIONAL_CONTEXT,
  buildHookOutput,
  run,
};

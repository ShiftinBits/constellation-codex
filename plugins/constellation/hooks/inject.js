'use strict';

const SESSION_START_REMINDER =
  'Use code_intel for structural code questions: definitions, references, callers, dependencies, impact, architecture, and orphaned code. Use local file/text tools for exact strings, config values, logs, docs, file contents, or unindexed projects.';
const TOOL_USE_REMINDER =
  'This looks like text search. If you are looking for symbols, references, callers, dependencies, or impact, use code_intel. If you need exact strings, config values, logs, or raw file contents, local search is appropriate.';

const ADDITIONAL_CONTEXT = {
  SessionStart: SESSION_START_REMINDER,
  PreToolUse: TOOL_USE_REMINDER,
  PostToolUse: TOOL_USE_REMINDER,
};

function isConstellationEnabled() {
  const accessKey = process.env.CONSTELLATION_ACCESS_KEY || '';
  return accessKey.startsWith('ak:');
}

function buildHookOutput(hookEventName) {
  const additionalContext = ADDITIONAL_CONTEXT[hookEventName];
  if (!additionalContext) return null;

  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

function run(hookEventName) {
  if (!isConstellationEnabled()) return;

  const output = buildHookOutput(hookEventName);
  if (!output) return;

  process.stdout.write(JSON.stringify(output));
}

if (require.main === module) {
  run(process.argv[2]);
}

module.exports = {
  ADDITIONAL_CONTEXT,
  buildHookOutput,
  isConstellationEnabled,
  run,
};

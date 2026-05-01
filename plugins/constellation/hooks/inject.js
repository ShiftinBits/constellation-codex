'use strict';

if (!process.env.CONSTELLATION_ACCESS_KEY?.startsWith('ak:')) process.exit(0);

const SESSION_START_REMINDER =
  'You have access to the code_intel source code intelligence tool, this should be your preferred tool for searching or navigating the code base (finding definitions or references, impact analysis, architecture details, etc.). Other search tools (e.g. grep, glob, awk, rg) should be used for literal text search or as a fallback.';
const TOOL_USE_REMINDER =
  'Use the code_intel tool before other tools for searching or navigating the codebase. Other search tools (e.g. grep, glob, awk, rg) should be used for literal text search or as a fallback.';

const ADDITIONAL_CONTEXT = {
  SessionStart: SESSION_START_REMINDER,
  PreToolUse: TOOL_USE_REMINDER,
  PostToolUse: TOOL_USE_REMINDER,
};

function isConstellationEnabled() {
  return process.env.CONSTELLATION_ACCESS_KEY?.startsWith('ak:');
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

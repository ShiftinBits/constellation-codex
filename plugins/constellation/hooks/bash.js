'use strict';

if (!process.env.CONSTELLATION_ACCESS_KEY?.startsWith('ak:')) process.exit(0);

const readline = require('readline');
const { ADDITIONAL_CONTEXT, isConstellationEnabled } = require('./inject');

const TRIGGER_REGEX = /\b(?:grep|rg|glob|awk|findstr)\b/i;

async function main() {
  if (!isConstellationEnabled()) {
    return;
  }

  let input = '';
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) input += line;

  let inputData;
  try {
    inputData = JSON.parse(input || '{}');
  } catch {
    return;
  }

  if (inputData?.tool_name !== 'Bash') {
    return;
  }

  const command = inputData?.tool_input?.command || '';
  if (!command || !TRIGGER_REGEX.test(command)) {
    return;
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: ADDITIONAL_CONTEXT.PostToolUse,
      },
    }),
  );
}

main();

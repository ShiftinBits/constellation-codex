'use strict';

const { contextOutput, emit, gitRoot, isConfigured, projectRoot, pruneStates, readInput } = require('./lib');

const SESSION_TEXT =
  'Constellation code intelligence is available through the code_intel tool for this project. Prefer code_intel over text search for definitions and details (searchSymbols, getSymbolDetails), usages and callers (traceSymbolUsage, getCallGraph), dependencies and cycles (getDependencies, getDependents, findCircularDependencies), architecture (getArchitectureOverview), and dead code (findOrphanedCode). Run impactAnalysis before editing a shared symbol. Use text search for literal strings, config values, logs, and code the project does not index.';

const EVENTS = new Set(['SessionStart', 'SubagentStart']);

const MISSING_KEY_MESSAGE =
  'Constellation is not set up: CONSTELLATION_ACCESS_KEY is missing or does not start with ak:. Run `constellation auth`, restart Codex, then run $constellation:get-started for the full setup steps.';

const NOT_INDEXED_TEXT =
  'Constellation is configured, but this project is not indexed (no constellation.json was found). If the user asks structural questions about the code (dependencies, callers, impact, architecture, dead code), suggest running `constellation init` and `constellation index`, or the $constellation:get-started skill. Use text search in the meantime.';

async function run() {
  const input = await readInput();
  const hookEventName = input.hook_event_name;
  if (!EVENTS.has(hookEventName)) return;

  if (!isConfigured()) {
    if (hookEventName === 'SessionStart' && input.source === 'startup') {
      emit({ systemMessage: MISSING_KEY_MESSAGE });
    }
    return;
  }

  if (projectRoot(input.cwd) === null) {
    if (hookEventName === 'SessionStart' && input.source === 'startup' && gitRoot(input.cwd) !== null) {
      emit(contextOutput(hookEventName, NOT_INDEXED_TEXT));
    }
    return;
  }

  if (hookEventName === 'SessionStart') pruneStates();
  emit(contextOutput(hookEventName, SESSION_TEXT));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  MISSING_KEY_MESSAGE,
  NOT_INDEXED_TEXT,
  SESSION_TEXT,
  run,
};

'use strict';

const { contextOutput, emit, isConfigured, projectRoot, pruneStates, readInput } = require('./lib');

const SESSION_TEXT =
  'Constellation code intelligence is available through the code_intel tool for this project. Prefer code_intel over text search for definitions and details (searchSymbols, getSymbolDetails), usages and callers (traceSymbolUsage, getCallGraph), dependencies and cycles (getDependencies, getDependents, findCircularDependencies), architecture (getArchitectureOverview), and dead code (findOrphanedCode). Run impactAnalysis before editing a shared symbol. Use text search for literal strings, config values, logs, and code the project does not index.';

const EVENTS = new Set(['SessionStart', 'SubagentStart']);

async function run() {
  if (!isConfigured()) return;

  const input = await readInput();
  const hookEventName = input.hook_event_name;
  if (!EVENTS.has(hookEventName)) return;
  if (projectRoot(input.cwd) === null) return;

  if (hookEventName === 'SessionStart') pruneStates();
  emit(contextOutput(hookEventName, SESSION_TEXT));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = {
  SESSION_TEXT,
  run,
};

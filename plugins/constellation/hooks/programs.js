'use strict';

/*
 * Programs that `mcp_tool` hooks run inside code_intel's hook mode. Each one is
 * serialized with Function.prototype.toString, so it may use only its own
 * arguments (`api`, `hook`) and what it declares in its body: no closure over
 * this module, no require. Codex expands every `${name}` in an mcp_tool input
 * string as an event placeholder, so a program never contains that sequence.
 */

/**
 * PostToolUse Bash: when the shell line searches for an identifier-like
 * pattern with grep, egrep, rg, ag, ack or `git grep`, adds one line naming
 * where the symbol is defined and how often it is used. Off unless
 * CONSTELLATION_AUGMENT_SEARCH is `1` or `true`. Returns null when the setting
 * is off, the line runs no symbol search, or no symbol has the exact name.
 */
async function augment(api, hook) {
  'use strict';
  const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const DECLARATION = /^(?:class|interface|function|def|func|type)\s+(\S+)$/;
  const SEARCH_COMMANDS = ['grep', 'egrep', 'rg', 'ag', 'ack'];
  const VALUE_FLAGS = ['-A', '-B', '-C', '-m', '-t', '-g', '--type', '--glob'];

  // Splits a shell line at each unquoted `|`, `||`, `;` and `&&` into commands
  // of words (quotes removed), each with the separator after it.
  function shellCommands(line) {
    const commands = [];
    let words = [];
    let word = '';
    let inWord = false;
    let quote = null;
    const endWord = () => {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    };
    const endCommand = (sep) => {
      endWord();
      commands.push({ words, sep });
      words = [];
    };
    for (let i = 0; i < line.length; i++) {
      const c = line.charAt(i);
      const pair = line.slice(i, i + 2);
      if (quote !== null) {
        if (c === quote) quote = null;
        else word += c;
      } else if (c === "'" || c === '"') {
        quote = c;
        inWord = true;
      } else if (pair === '&&' || pair === '||') {
        endCommand(pair);
        i++;
      } else if (c === '|' || c === ';') {
        endCommand(c);
      } else if (/\s/.test(c)) {
        endWord();
      } else {
        word += c;
        inWord = true;
      }
    }
    endCommand('');
    return commands;
  }

  // The pattern the line's search command looks for: the leading command, or
  // the one after a leading `cd <dir> &&`. Words after a pipe are not its own.
  function searchPattern(line) {
    const commands = shellCommands(line);
    let words = commands[0].words;
    if (words[0] === 'cd' && words.length === 2 && commands[0].sep === '&&') words = commands[1].words;
    let args;
    if (words[0] === 'git' && words[1] === 'grep') args = words.slice(2);
    else if (SEARCH_COMMANDS.includes(words[0])) args = words.slice(1);
    else return null;
    let pattern;
    const operands = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-e' || arg === '--regexp') pattern = args[++i];
      else if (arg.startsWith('--regexp=')) pattern = arg.slice('--regexp='.length);
      else if (VALUE_FLAGS.includes(arg)) i++;
      else if (!arg.startsWith('-')) operands.push(arg);
    }
    if (pattern === undefined) pattern = operands[0];
    return pattern === undefined ? null : pattern;
  }

  // The bare identifier a pattern names: `X`, `class X` (and the other
  // declaration keywords), `X\(` or `\bX\b`; null for anything else.
  function symbolOf(pattern) {
    let text = pattern.trim();
    const declaration = DECLARATION.exec(text);
    if (declaration) text = declaration[1];
    text = text.replace(/^\\b/, '').replace(/\\b$/, '').replace(/\\\(\\\)$|\\\($/, '');
    return IDENTIFIER.test(text) ? text : null;
  }

  // The most used exact-name match, among exported symbols first, then among
  // used symbols that are not exported; null when nothing matches.
  async function lookupSymbol(api, name) {
    const exact = async (isExported) =>
      (
        await api.searchSymbols({ query: name, limit: 100, includeUsageCount: true, ...(isExported ? { isExported } : {}) })
      ).symbols.filter((s) => s.name === name);
    let hits = await exact(true);
    if (hits.length === 0) hits = (await exact()).filter((s) => (s.usageCount ?? 0) > 0);
    const hit = hits.reduce((a, b) => (a === null || (b.usageCount ?? 0) > (a.usageCount ?? 0) ? b : a), null);
    if (hit === null) return null;
    return { name: hit.name, kind: hit.kind, filePath: hit.filePath, line: hit.line, usages: hit.usageCount ?? 0 };
  }

  const setting = hook.settings && hook.settings.CONSTELLATION_AUGMENT_SEARCH;
  if (setting !== '1' && setting !== 'true') return null;
  const input = hook.input;
  if (!input || input.tool_name !== 'Bash') return null;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return null;
  const pattern = searchPattern(command);
  const symbol = pattern === null ? null : symbolOf(pattern);
  if (symbol === null) return null;

  const found = await lookupSymbol(api, symbol);
  if (found === null) return null;
  const usages = found.usages + (found.usages === 1 ? ' usage' : ' usages');
  return {
    context:
      '`' + found.name + '` (' + found.kind + ') defined at `' + found.filePath + ':' + found.line + '`, ' + usages +
      '. code_intel api.traceSymbolUsage lists every usage.',
  };
}

/** The code_intel program that runs `fn` with hook mode's `api` and `hook` globals. */
function programOf(fn) {
  return `return await (${fn.toString()})(api, hook);`;
}

/** Program literals by hooks.json `<event>:<matcher>` of their mcp_tool entry. */
const PROGRAMS = {
  'PostToolUse:Bash': programOf(augment),
};

module.exports = {
  PROGRAMS,
  augment,
};

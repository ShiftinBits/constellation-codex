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

/**
 * PreToolUse apply_patch, Edit and Write: names the files the patch updates,
 * deletes or moves to whose direct dependents make a change high or critical
 * risk, with their top dependents, the symbols they use and how many are tests.
 * Off unless CONSTELLATION_IMPACT_NOTICE is `1` or `true`. Returns null when
 * the setting is off or no touched file is high or critical risk. Files added
 * by the patch are ignored, and each file is reported once per session.
 */
async function impact(api, hook) {
  'use strict';
  const MAX_FILES = 40;
  const MAX_CONTEXT = 6000;

  // Ported from the Claude Code plugin's risk levels: untuned cut-offs on the
  // count of direct dependents.
  function levelOf(dependents) {
    if (dependents >= 50) return 'critical';
    if (dependents >= 20) return 'high';
    if (dependents >= 5) return 'medium';
    return 'low';
  }

  // Ported from the Claude Code plugin's test exposure check.
  function isTestFile(path) {
    const p = path.replace(/\\/g, '/');
    const name = p.slice(p.lastIndexOf('/') + 1);
    return (
      /\.(?:test|spec)\./.test(name) ||
      /(?:^|\/)(?:__tests__|[Tt]ests?|[^/]+\.Tests?)\//.test(p) ||
      name.endsWith('_test.go') ||
      /^test_.*\.py$/.test(name) ||
      /_test\.py$/.test(name) ||
      /[a-z0-9]Tests?\.(?:cs|java|kt)$/.test(name)
    );
  }

  // The paths a patch updates, deletes or moves to; `*** Add File:` is ignored.
  function patchPaths(patch) {
    const paths = [];
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\* (?:Update File|Delete File|Move to): (.+?)\s*$/.exec(line);
      if (match) paths.push(match[1]);
    }
    return paths;
  }

  // The path relative to `cwd` as POSIX; null when it is outside `cwd`.
  function relativeTo(cwd, target) {
    const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    let rest = target.replace(/\\/g, '/');
    if (rest.startsWith('/') || /^[A-Za-z]:\//.test(rest)) {
      if (!rest.startsWith(root + '/')) return null;
      rest = rest.slice(root.length + 1);
    }
    const parts = [];
    for (const part of rest.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (parts.length === 0) return null;
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return parts.length === 0 ? null : parts.join('/');
  }

  function isNotFound(error) {
    const text = String((error && error.code) || '') + ' ' + String((error && error.message) || error);
    return /not[ _-]?found/i.test(text);
  }

  async function dependentsOf(filePath) {
    try {
      return (await api.getDependents({ filePath, limit: 100, includeSymbols: true })).directDependents || [];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  const setting = hook.settings && hook.settings.CONSTELLATION_IMPACT_NOTICE;
  if (setting !== '1' && setting !== 'true') return null;
  const input = hook.input;
  if (!input || typeof input.cwd !== 'string') return null;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return null;

  const files = [];
  for (const target of patchPaths(command)) {
    const rel = relativeTo(input.cwd, target);
    if (rel !== null && !files.includes(rel)) files.push(rel);
  }

  const risky = [];
  for (const path of files.slice(0, MAX_FILES)) {
    if (!hook.once('impact:' + path)) continue;
    const dependents = await dependentsOf(path);
    const level = levelOf(dependents.length);
    if (level !== 'high' && level !== 'critical') continue;
    const used = [...new Set(dependents.flatMap((d) => d.usedSymbols || []))];
    risky.push({
      path,
      level,
      count: dependents.length,
      top: dependents.slice(0, 3).map((d) => d.filePath),
      used: used.slice(0, 10),
      tests: dependents.filter((d) => isTestFile(d.filePath)).length,
    });
  }
  if (risky.length === 0) return null;

  const lines = ['Constellation: this patch touches files with many dependents.'];
  for (const file of risky) {
    const count = file.count >= 100 ? '100+' : String(file.count);
    let line = '- `' + file.path + '`: ' + file.level + ' risk, ' + count + ' dependents';
    if (file.top.length > 0) line += ', e.g. ' + file.top.map((p) => '`' + p + '`').join(', ');
    if (file.used.length > 0) line += '; used symbols: ' + file.used.join(', ');
    line += '; ' + file.tests + (file.tests === 1 ? ' test dependent' : ' test dependents');
    lines.push(line);
  }
  lines.push('Before changing behavior, run code_intel api.impactAnalysis or api.traceSymbolUsage on the affected symbols.');
  let context = lines.join('\n');
  if (context.length > MAX_CONTEXT) context = context.slice(0, MAX_CONTEXT - 3) + '...';

  const first = risky[0];
  const more = risky.length > 1 ? ' (+' + (risky.length - 1) + ' more)' : '';
  const firstCount = first.count >= 100 ? '100+' : String(first.count);
  return { context, message: first.path + ': ' + first.level + ' risk, ' + firstCount + ' dependents' + more };
}

/** The code_intel program that runs `fn` with hook mode's `api` and `hook` globals. */
function programOf(fn) {
  return `return await (${fn.toString()})(api, hook);`;
}

/** Program literals by hooks.json `<event>:<matcher>` of their mcp_tool entry. */
const PROGRAMS = {
  'PostToolUse:Bash': programOf(augment),
  'PreToolUse:apply_patch|Edit|Write': programOf(impact),
};

module.exports = {
  PROGRAMS,
  augment,
  impact,
};

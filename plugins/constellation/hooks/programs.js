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
 * where the symbol is defined and how often it is used. Returns null when the
 * line runs no symbol search or no symbol has the exact name.
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
 * Returns null when no touched file is high or critical risk. Files added by
 * the patch are ignored, and each file is reported once per session. The
 * context stays within MAX_CONTEXT and always ends with the impactAnalysis
 * instruction: a file line drops its details when they do not fit, and a file
 * whose line cannot fit at all is left for a later patch. Dependents are
 * fetched concurrently to stay inside hook mode's time budget.
 */
async function impact(api, hook) {
  'use strict';
  const MAX_FILES = 40;
  const MAX_CONTEXT = 6000;
  // hook.once throws for a longer key.
  const MAX_KEY = 256;

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

  // Core's error for a file the graph does not hold, alone or on the `Error:`
  // line of the sandbox's wrapped message. Only the start of a line counts, so
  // a path such as `app/not-found.tsx` echoed in the parameters never does.
  function isNotFound(error) {
    return /^\s*(?:Error: )?File not found: /m.test(String((error && error.message) || error));
  }

  async function dependentsOf(filePath) {
    try {
      return (await api.getDependents({ filePath, limit: 100, includeSymbols: true })).directDependents || [];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  const input = hook.input;
  if (!input || typeof input.cwd !== 'string') return null;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return null;

  const files = [];
  for (const target of patchPaths(command)) {
    const rel = relativeTo(input.cwd, target);
    if (rel !== null && !files.includes(rel)) files.push(rel);
  }

  const countOf = (dependents) => (dependents >= 100 ? '100+' : String(dependents));
  const summaryOf = (path, level, dependents) => '`' + path + '`: ' + level + ' risk, ' + countOf(dependents) + ' dependents';

  // The longest a file's line can be without details, with its newline.
  const shortestOf = (path) => '- '.length + summaryOf(path, 'critical', 100).length + 1;

  const header = 'Constellation: this patch touches files with many dependents.';
  const footer = 'Before changing behavior, run code_intel api.impactAnalysis or api.traceSymbolUsage on the affected symbols.';
  // Characters left for file lines, each with its newline.
  let room = MAX_CONTEXT - header.length - 1 - footer.length;
  // A file is claimed only while its shortest line still fits beside those of
  // the files claimed before it, so every claimed file can be listed and a
  // file left out for space stays unclaimed for a later patch.
  const claimed = [];
  for (const path of files.slice(0, MAX_FILES)) {
    const key = 'impact:' + path;
    if (key.length > MAX_KEY || shortestOf(path) > room) continue;
    if (!hook.once(key)) continue;
    claimed.push(path);
    room -= shortestOf(path);
  }
  const found = await Promise.all(claimed.map(dependentsOf));
  const risky = [];
  claimed.forEach((path, i) => {
    const level = levelOf(found[i].length);
    if (level === 'high' || level === 'critical') risky.push({ path, level, dependents: found[i] });
    else room += shortestOf(path);
  });
  if (risky.length === 0) return null;

  // In path order, a line keeps its details when they fit in the room left
  // plus what its shortest line reserved.
  const lines = [header];
  for (const { path, level, dependents } of risky) {
    room += shortestOf(path);
    const summary = '- ' + summaryOf(path, level, dependents.length);
    const top = dependents.slice(0, 3).map((d) => d.filePath);
    const used = [...new Set(dependents.flatMap((d) => d.usedSymbols || []))].slice(0, 10);
    const tests = dependents.filter((d) => isTestFile(d.filePath)).length;
    let line = summary;
    if (top.length > 0) line += ', e.g. ' + top.map((p) => '`' + p + '`').join(', ');
    if (used.length > 0) line += '; used symbols: ' + used.join(', ');
    line += '; ' + tests + (tests === 1 ? ' test dependent' : ' test dependents');
    if (line.length + 1 > room) line = summary;
    lines.push(line);
    room -= line.length + 1;
  }
  lines.push(footer);

  const first = risky[0];
  const more = risky.length > 1 ? ' (+' + (risky.length - 1) + ' more)' : '';
  return {
    context: lines.join('\n'),
    message: first.path + ': ' + first.level + ' risk, ' + countOf(first.dependents.length) + ' dependents' + more,
  };
}

/** The code_intel program that runs `fn` with hook mode's `api` and `hook` globals. */
function programOf(fn) {
  return `return await (${fn.toString()})(api, hook);`;
}

/** Program literals by opt-in-hooks.json `<event>:<matcher>` of their mcp_tool entry. */
const PROGRAMS = {
  'PostToolUse:Bash': programOf(augment),
  'PreToolUse:apply_patch|Edit|Write': programOf(impact),
};

module.exports = {
  PROGRAMS,
  augment,
  impact,
};

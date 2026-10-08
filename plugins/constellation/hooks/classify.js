'use strict';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DECLARATION = /^(?:class|interface|function|def|func|type)\s+(\S+)$/;
const SEARCH_COMMANDS = new Set(['grep', 'egrep', 'rg', 'ag', 'ack']);

/** Language keywords: a search for one is a literal text search, not a symbol lookup. */
const KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'final', 'finally', 'for', 'from', 'func',
  'function', 'go', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'namespace', 'new',
  'nil', 'none', 'null', 'package', 'pass', 'private', 'protected', 'public', 'require', 'return', 'self',
  'static', 'struct', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'using',
  'var', 'void', 'while', 'with', 'yield',
]);

/**
 * Short flags whose value is the next argument. Letters that take no value in
 * grep (`-r`, `-G`, `-T`) are left out even where rg or ag give them one.
 */
const VALUE_FLAGS = new Set(['-A', '-B', '-C', '-d', '-D', '-f', '-g', '-j', '-m', '-M', '-t']);
const LONG_VALUE_FLAGS = new Set([
  '--after-context', '--before-context', '--context', '--exclude', '--exclude-dir', '--file', '--file-search-regex',
  '--glob', '--iglob', '--ignore-dir', '--include', '--max-columns', '--max-count', '--max-depth', '--replace',
  '--threads', '--type', '--type-not',
]);

/**
 * The bare identifier a search pattern looks for, or null when the pattern is
 * not identifier-like.
 *
 * Identifier-like: a bare identifier (`AuthService`, `get_user`); a declaration
 * keyword and a name (`class X`, `interface X`, `function X`, `def X`,
 * `func X`, `type X`); a name followed by an escaped open paren (`X\(`); a name
 * between regex word boundaries (`\bX\b`).
 *
 * Not identifier-like: text with other whitespace (quoted phrases, error and
 * log text), regex with character classes, alternation or quantifiers, and
 * keys containing `.` or `/`. A word with no lowercase letter (`TODO`,
 * `FIXME`, `ERROR`, and `MAX_RETRIES` too) is a marker or constant, not a
 * name worth a graph lookup, and a language keyword (`import`, `export`) is
 * literal text, so neither is identifier-like.
 */
function symbolOf(pattern) {
  let text = pattern.trim();
  const declaration = DECLARATION.exec(text);
  if (declaration && declaration[1] !== undefined) text = declaration[1];
  text = text.replace(/^\\b/, '').replace(/\\b$/, '').replace(/\\\(\\\)$|\\\($/, '');
  if (!IDENTIFIER.test(text) || !/[a-z]/.test(text) || KEYWORDS.has(text)) return null;
  return text;
}

/** True when `pattern` is identifier-like, see symbolOf. */
function isSymbolLike(pattern) {
  return symbolOf(pattern) !== null;
}

/**
 * Splits a shell line into commands at each unquoted `|`, `||`, `;` and `&&`.
 * Each command holds its words (quotes removed) and the separator after it
 * (`''` at the end of the line).
 */
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

/** `words` without leading variable assignments (`LC_ALL=C grep ...`). */
function withoutAssignments(words) {
  const first = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  return first === -1 ? [] : words.slice(first);
}

/** `path` under `dir` when both are given and `path` is relative. */
function under(dir, path) {
  if (dir === undefined) return path;
  if (path === undefined) return dir;
  return /^([A-Za-z]:)?[\\/]/.test(path) ? path : `${dir}/${path}`;
}

/**
 * The search a shell line runs as `{ pattern, path }`, or null when it runs
 * none. The search is the leading command (`grep`, `egrep`, `rg`, `ag`, `ack`
 * or `git grep`, after any variable assignments), or the command after a
 * leading `cd <dir> &&` (or `;`), which then searches under that directory. A
 * command after a pipe filters output, so it never counts. `path` is the
 * first path searched; undefined means the working directory.
 *
 * The pattern is the value of `-e` or `--regexp` when given (`-eFoo` and
 * `--regexp=Foo` too), else the first argument that is neither a flag nor a
 * flag's value; the path is the first such argument after it.
 */
function bashSearch(line) {
  const commands = shellCommands(line);
  let dir;
  let words = withoutAssignments((commands[0] && commands[0].words) || []);
  if (words[0] === 'cd' && words.length === 2 && commands[0] && (commands[0].sep === '&&' || commands[0].sep === ';')) {
    dir = words[1];
    words = withoutAssignments((commands[1] && commands[1].words) || []);
  }
  let args;
  if (words[0] === 'git') {
    let next = 1;
    if (words[next] === '-C' && words[next + 1] !== undefined) {
      dir = under(dir, words[next + 1]);
      next += 2;
    }
    if (words[next] !== 'grep') return null;
    args = words.slice(next + 1);
  } else if (SEARCH_COMMANDS.has(words[0] || '')) {
    args = words.slice(1);
  } else {
    return null;
  }

  let pattern;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] || '';
    if (arg === '-e' || arg === '--regexp') pattern = args[++i];
    else if (arg.startsWith('--regexp=')) pattern = arg.slice('--regexp='.length);
    else if (/^-e./.test(arg)) pattern = arg.slice(2);
    else if (arg === '--') {
      operands.push(...args.slice(i + 1));
      break;
    } else if (VALUE_FLAGS.has(arg) || LONG_VALUE_FLAGS.has(arg)) i++;
    else if (!arg.startsWith('-')) operands.push(arg);
  }
  if (pattern === undefined) pattern = operands.shift();
  if (pattern === undefined) return null;
  return { pattern, path: under(dir, operands[0]) };
}

module.exports = {
  bashSearch,
  isSymbolLike,
  symbolOf,
};

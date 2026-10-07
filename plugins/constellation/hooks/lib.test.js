'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('./lib');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hooks-'));
}

function readInputInChild(stdin) {
  const script = `require(${JSON.stringify(path.join(__dirname, 'lib.js'))}).readInput().then((v) => process.stdout.write(JSON.stringify(v)));`;
  const result = spawnSync(process.execPath, ['-e', script], { input: stdin, encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

test('readInput returns {} for empty stdin', () => {
  assert.deepStrictEqual(readInputInChild(''), {});
});

test('readInput returns {} for invalid JSON', () => {
  assert.deepStrictEqual(readInputInChild('not json'), {});
});

test('readInput returns {} for non-object JSON', () => {
  assert.deepStrictEqual(readInputInChild('42'), {});
  assert.deepStrictEqual(readInputInChild('null'), {});
});

test('readInput parses valid JSON', () => {
  assert.deepStrictEqual(readInputInChild('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
});

test('isConfigured requires the ak: prefix', () => {
  assert.strictEqual(lib.isConfigured({ CONSTELLATION_ACCESS_KEY: 'ak:test' }), true);
  assert.strictEqual(lib.isConfigured({ CONSTELLATION_ACCESS_KEY: 'sk:test' }), false);
  assert.strictEqual(lib.isConfigured({}), false);
});

test('projectRoot finds the nearest constellation.json walking up', () => {
  const root = tmpDir();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(lib.projectRoot(nested), null);
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  assert.strictEqual(lib.projectRoot(nested), root);
  fs.writeFileSync(path.join(root, 'a', 'constellation.json'), '{}');
  assert.strictEqual(lib.projectRoot(nested), path.join(root, 'a'));
});

test('projectRoot returns null for missing cwd', () => {
  assert.strictEqual(lib.projectRoot(undefined), null);
  assert.strictEqual(lib.projectRoot(''), null);
});

test('gitRoot finds the nearest .git entry walking up', () => {
  const root = tmpDir();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(lib.gitRoot(nested), null);
  fs.mkdirSync(path.join(root, '.git'));
  assert.strictEqual(lib.gitRoot(nested), root);
  fs.writeFileSync(path.join(root, 'a', '.git'), 'gitdir: elsewhere');
  assert.strictEqual(lib.gitRoot(nested), path.join(root, 'a'));
});

test('gitRoot returns null for missing cwd', () => {
  assert.strictEqual(lib.gitRoot(undefined), null);
  assert.strictEqual(lib.gitRoot(''), null);
});

test('contextOutput builds the additionalContext shape', () => {
  assert.deepStrictEqual(lib.contextOutput('SessionStart', 'hi'), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hi' },
  });
});

test('emit writes JSON only for non-null output', () => {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    lib.emit(null);
    lib.emit({ a: 1 });
  } finally {
    process.stdout.write = original;
  }
  assert.deepStrictEqual(writes, ['{"a":1}']);
});

test('saveState and loadState round trip and sanitize the session id', () => {
  const data = tmpDir();
  process.env.PLUGIN_DATA = data;
  try {
    lib.saveState('sess/../abc', { count: 2 });
    assert.deepStrictEqual(lib.loadState('sess/../abc'), { count: 2 });
    assert.deepStrictEqual(fs.readdirSync(path.join(data, 'sessions')), ['sessabc.json']);
    assert.deepStrictEqual(lib.loadState('missing'), {});
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('state is skipped when the sanitized session id is empty', () => {
  const data = tmpDir();
  process.env.PLUGIN_DATA = data;
  try {
    lib.saveState('///', { count: 1 });
    lib.saveState(undefined, { count: 1 });
    assert.strictEqual(fs.existsSync(path.join(data, 'sessions')), false);
    assert.deepStrictEqual(lib.loadState('///'), {});
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('an unwritable PLUGIN_DATA yields {} and does not throw', () => {
  const data = tmpDir();
  const blocker = path.join(data, 'file');
  fs.writeFileSync(blocker, 'x');
  process.env.PLUGIN_DATA = blocker;
  try {
    assert.doesNotThrow(() => lib.saveState('abc', { a: 1 }));
    assert.deepStrictEqual(lib.loadState('abc'), {});
    assert.doesNotThrow(() => lib.pruneStates());
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('loadState returns {} for corrupt state', () => {
  const data = tmpDir();
  fs.mkdirSync(path.join(data, 'sessions'));
  fs.writeFileSync(path.join(data, 'sessions', 'abc.json'), '{broken');
  process.env.PLUGIN_DATA = data;
  try {
    assert.deepStrictEqual(lib.loadState('abc'), {});
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('pruneStates removes only files older than seven days', () => {
  const data = tmpDir();
  process.env.PLUGIN_DATA = data;
  try {
    lib.saveState('old', { a: 1 });
    lib.saveState('new', { a: 2 });
    const oldFile = path.join(data, 'sessions', 'old.json');
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, eightDays, eightDays);
    lib.pruneStates();
    assert.strictEqual(fs.existsSync(oldFile), false);
    assert.deepStrictEqual(lib.loadState('new'), { a: 2 });
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('saveState merges only what changed, so overlapping hooks keep each other\'s writes', () => {
  const data = tmpDir();
  process.env.PLUGIN_DATA = data;
  try {
    lib.saveState('abc', { nudges: { main: 1 }, index: { '/a': { asOfCommit: 'aaaaaaa' } } });
    const first = lib.loadState('abc');
    const second = lib.loadState('abc');
    lib.saveState('abc', { ...second, codeIntelTurn: { main: 'turn-2' } }, second);
    lib.saveState('abc', { ...first, nudges: { ...first.nudges, agent: 1 } }, first);
    assert.deepStrictEqual(lib.loadState('abc'), {
      nudges: { main: 1, agent: 1 },
      index: { '/a': { asOfCommit: 'aaaaaaa' } },
      codeIntelTurn: { main: 'turn-2' },
    });
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

test('pruneStates removes temp files left by an interrupted save', () => {
  const data = tmpDir();
  process.env.PLUGIN_DATA = data;
  try {
    lib.saveState('abc', { a: 1 });
    const stale = path.join(data, 'sessions', '.abc.1.2.x.tmp');
    fs.writeFileSync(stale, '{}');
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stale, eightDays, eightDays);
    lib.pruneStates();
    assert.strictEqual(fs.existsSync(stale), false);
    assert.deepStrictEqual(lib.loadState('abc'), { a: 1 });
  } finally {
    delete process.env.PLUGIN_DATA;
  }
});

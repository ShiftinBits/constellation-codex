'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'code-intel.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

function runHook(input, { key = 'ak:test', data } = {}) {
  const env = { ...process.env, PLUGIN_DATA: data };
  delete env.CONSTELLATION_ACCESS_KEY;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: stdin, env, encoding: 'utf8' });
}

const dataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
const stateOf = (data, id) => JSON.parse(fs.readFileSync(path.join(data, 'sessions', `${id}.json`), 'utf8'));

test('stamps the turn for the main agent and emits nothing', () => {
  const data = dataDir();
  const result = runHook(fixture('post-tool-use-code-intel.json'), { data });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  assert.deepStrictEqual(stateOf(data, 'sess-abc123').codeIntelTurn, { main: 'turn-1' });
});

test('stamps per agent and keeps other state', () => {
  const data = dataDir();
  runHook(fixture('post-tool-use-code-intel.json'), { data });
  runHook({ ...fixture('post-tool-use-code-intel.json'), agent_id: 'agent-1', turn_id: 'turn-4' }, { data });
  assert.deepStrictEqual(stateOf(data, 'sess-abc123').codeIntelTurn, { main: 'turn-1', 'agent-1': 'turn-4' });
});

test('writes nothing without an ak: key', () => {
  const data = dataDir();
  runHook(fixture('post-tool-use-code-intel.json'), { data, key: '' });
  assert.strictEqual(fs.existsSync(path.join(data, 'sessions')), false);
});

test('malformed stdin and a missing turn write nothing', () => {
  const data = dataDir();
  assert.strictEqual(runHook('not json', { data }).status, 0);
  const { turn_id: _turn, ...noTurn } = fixture('post-tool-use-code-intel.json');
  assert.strictEqual(runHook(noTurn, { data }).status, 0);
  assert.strictEqual(fs.existsSync(path.join(data, 'sessions')), false);
});

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

function indexedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ci-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  return root;
}

/** The fixture with both the session cwd and the code_intel call's cwd at `cwd`. */
const at = (input, cwd) => ({ ...input, cwd, tool_input: { ...input.tool_input, cwd } });

test('stores the indexed commit for the project root from structuredContent', () => {
  const data = dataDir();
  const root = indexedRoot();
  runHook(at(fixture('post-tool-use-code-intel.json'), root), { data });
  assert.deepStrictEqual(stateOf(data, 'sess-abc123').index, {
    [root]: { asOfCommit: '0123456789abcdef0123456789abcdef01234567', lastIndexedAt: '2026-01-01T00:00:00.000Z' },
  });
});

test('stores the indexed commit from a text block and without a turn id', () => {
  const data = dataDir();
  const root = indexedRoot();
  const input = fixture('post-tool-use-code-intel.json');
  delete input.turn_id;
  delete input.tool_response.structuredContent;
  runHook(at(input, root), { data });
  const state = stateOf(data, 'sess-abc123');
  assert.strictEqual(state.index[root].asOfCommit, '0123456789abcdef0123456789abcdef01234567');
  assert.strictEqual(state.codeIntelTurn, undefined);
});

test('does not store an invalid commit or an error envelope', () => {
  const data = dataDir();
  const root = indexedRoot();
  const bad = fixture('post-tool-use-code-intel.json');
  bad.tool_response.structuredContent.asOfCommit = '--upload-pack=x';
  runHook(at(bad, root), { data });
  runHook(at(fixture('post-tool-use-code-intel-error.json'), root), { data });
  assert.strictEqual(stateOf(data, 'sess-abc123').index, undefined);
});

test('stores the indexed commit for the project the call queried, not the session cwd', () => {
  const data = dataDir();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ws-'));
  const project = path.join(workspace, 'api');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'constellation.json'), '{}');
  const input = fixture('post-tool-use-code-intel.json');
  runHook({ ...input, cwd: workspace, tool_input: { ...input.tool_input, cwd: 'api' } }, { data });
  assert.deepStrictEqual(Object.keys(stateOf(data, 'sess-abc123').index), [project]);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'bash.js');
const CODE_INTEL_HOOK = path.join(__dirname, 'code-intel.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

function indexedProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bash-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  return root;
}

function setup() {
  return { root: indexedProject(), data: fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-')) };
}

function runScript(script, input, { key = 'ak:test', data, limit } = {}) {
  const env = { ...process.env };
  delete env.CONSTELLATION_ACCESS_KEY;
  delete env.CONSTELLATION_NUDGE_LIMIT;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  if (data) env.PLUGIN_DATA = data;
  if (limit !== undefined) env.CONSTELLATION_NUDGE_LIMIT = limit;
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [script], { input: stdin, env, encoding: 'utf8' });
}

function search(root, command, extra = {}) {
  return { ...fixture('post-tool-use-bash-search.json'), cwd: root, tool_input: { command }, ...extra };
}

test('a symbol search in an indexed project nudges naming the symbol', () => {
  const { root, data } = setup();
  const result = runScript(HOOK, search(root, 'rg "UserService"'), { data });
  assert.strictEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /`UserService` looks like a symbol/);
  assert.match(output.hookSpecificOutput.additionalContext, /code_intel/);
});

test('a relative search path resolves against cwd', () => {
  const { root, data } = setup();
  const sub = path.join(root, 'src');
  fs.mkdirSync(sub);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-outside-'));
  assert.notStrictEqual(runScript(HOOK, search(sub, 'grep -rn UserService ..'), { data }).stdout, '');
  assert.strictEqual(runScript(HOOK, search(sub, `grep -rn UserService ${outside}`), { data }).stdout, '');
});

for (const command of ['rg "connection refused"', 'grep -r TODO', 'ls -la', 'cat file | grep UserService']) {
  test(`no nudge for ${command}`, () => {
    const { root, data } = setup();
    assert.strictEqual(runScript(HOOK, search(root, command), { data }).stdout, '');
  });
}

test('no nudge outside a constellation.json tree', () => {
  const { data } = setup();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bare-'));
  assert.strictEqual(runScript(HOOK, search(bare, 'rg UserService'), { data }).stdout, '');
});

test('no nudge without an ak: key', () => {
  const { root, data } = setup();
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService'), { data, key: '' }).stdout, '');
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService'), { data, key: 'sk:test' }).stdout, '');
});

test('other tools and malformed stdin emit nothing', () => {
  const { root, data } = setup();
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService', { tool_name: 'apply_patch' }), { data }).stdout, '');
  const result = runScript(HOOK, 'not json', { data });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('nudges at most the default of three per session', () => {
  const { root, data } = setup();
  const counts = [1, 2, 3, 4].map(() => (runScript(HOOK, search(root, 'rg UserService'), { data }).stdout === '' ? 0 : 1));
  assert.deepStrictEqual(counts, [1, 1, 1, 0]);
});

test('CONSTELLATION_NUDGE_LIMIT sets the budget and 0 disables nudges', () => {
  const { root, data } = setup();
  const two = [1, 2, 3].map(() => (runScript(HOOK, search(root, 'rg UserService'), { data, limit: '2' }).stdout === '' ? 0 : 1));
  assert.deepStrictEqual(two, [1, 1, 0]);
  const other = setup();
  assert.strictEqual(runScript(HOOK, search(other.root, 'rg UserService'), { data: other.data, limit: '0' }).stdout, '');
});

test('an invalid limit falls back to the default', () => {
  const { root, data } = setup();
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService'), { data, limit: 'many' }).stdout, '');
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService'), { data, limit: '-1' }).stdout, '');
});

test('each agent has its own budget', () => {
  const { root, data } = setup();
  const one = { agent_id: 'agent-1' };
  runScript(HOOK, search(root, 'rg UserService', one), { data, limit: '1' });
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService', one), { data, limit: '1' }).stdout, '');
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService', { agent_id: 'agent-2' }), { data, limit: '1' }).stdout, '');
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService'), { data, limit: '1' }).stdout, '');
});

test('no nudge after code_intel in the same turn, nudge again in a new turn', () => {
  const { root, data } = setup();
  const stamp = { ...fixture('post-tool-use-code-intel.json'), cwd: root };
  assert.strictEqual(runScript(CODE_INTEL_HOOK, stamp, { data }).status, 0);
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService'), { data }).stdout, '');
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService', { turn_id: 'turn-2' }), { data }).stdout, '');
});

test('code_intel in one agent does not silence another', () => {
  const { root, data } = setup();
  runScript(CODE_INTEL_HOOK, { ...fixture('post-tool-use-code-intel.json'), cwd: root, agent_id: 'agent-1' }, { data });
  assert.strictEqual(runScript(HOOK, search(root, 'rg UserService', { agent_id: 'agent-1' }), { data }).stdout, '');
  assert.notStrictEqual(runScript(HOOK, search(root, 'rg UserService'), { data }).stdout, '');
});

function gitIn(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
}

/** An indexed project whose HEAD is one commit past the commit the index reflects; the session has seen that index. */
function behindProject(data) {
  const root = indexedProject();
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', 'constellation.json');
  gitIn(root, 'commit', '-q', '-m', 'first');
  const indexed = gitIn(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  gitIn(root, 'add', 'a.txt');
  gitIn(root, 'commit', '-q', '-m', 'second');
  const response = { structuredContent: { success: true, asOfCommit: indexed, lastIndexedAt: '2026-01-01T00:00:00.000Z' } };
  runScript(CODE_INTEL_HOOK, { ...fixture('post-tool-use-code-intel.json'), cwd: root, tool_response: response }, { data });
  return { root, indexed };
}

const gitCall = (root, command, extra = {}) => ({ ...fixture('post-tool-use-bash.json'), cwd: root, tool_input: { command }, ...extra });

for (const verb of ['commit', 'pull', 'checkout', 'merge', 'rebase']) {
  test(`git ${verb} warns when the index is behind HEAD`, () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
    const { root, indexed } = behindProject(data);
    const result = runScript(HOOK, gitCall(root, `git ${verb} somewhere`), { data });
    assert.strictEqual(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.ok(output.hookSpecificOutput.additionalContext.includes(`\`${indexed.slice(0, 7)}\``));
    assert.match(output.hookSpecificOutput.additionalContext, /\(1 commit behind\)/);
    assert.match(output.systemMessage, /constellation index/);
  });
}

test('the freshness warning fires once per HEAD and the reindex suggestion once per session', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
  const { root } = behindProject(data);
  assert.notStrictEqual(runScript(HOOK, gitCall(root, 'git pull'), { data }).stdout, '');
  assert.strictEqual(runScript(HOOK, gitCall(root, 'git pull'), { data }).stdout, '');

  fs.writeFileSync(path.join(root, 'b.txt'), 'b');
  gitIn(root, 'add', 'b.txt');
  gitIn(root, 'commit', '-q', '-m', 'third');
  const output = JSON.parse(runScript(HOOK, gitCall(root, 'git commit'), { data }).stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /\(2 commits behind\)/);
  assert.strictEqual(output.systemMessage, undefined);
});

test('a non-git command does not warn', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
  const { root } = behindProject(data);
  assert.strictEqual(runScript(HOOK, gitCall(root, 'ls -la'), { data }).stdout, '');
});

test('git moves without a known indexed commit stay silent and spawn no git', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
  const root = indexedProject();
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-shim-'));
  const marker = path.join(shim, 'spawned');
  fs.writeFileSync(path.join(shim, 'git'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  const env = { ...process.env, CONSTELLATION_ACCESS_KEY: 'ak:test', PLUGIN_DATA: data, PATH: `${shim}${path.delimiter}${process.env.PATH}` };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(gitCall(root, 'git pull')), env, encoding: 'utf8' });
  assert.strictEqual(result.stdout, '');
  assert.ok(!fs.existsSync(marker));
});

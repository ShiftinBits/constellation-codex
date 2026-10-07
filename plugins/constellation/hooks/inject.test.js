'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MISSING_KEY_MESSAGE, NOT_INDEXED_TEXT, SESSION_TEXT } = require('./inject');

const HOOK = path.join(__dirname, 'inject.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

function indexedProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-inject-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  return root;
}

function runHook(input, { key = 'ak:test', data } = {}) {
  const env = { ...process.env };
  delete env.CONSTELLATION_ACCESS_KEY;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  if (data) env.PLUGIN_DATA = data;
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: stdin, env, encoding: 'utf8' });
}

for (const name of ['session-start.json', 'subagent-start.json']) {
  const event = fixture(name).hook_event_name;

  test(`${event} in an indexed project emits session guidance`, () => {
    const result = runHook({ ...fixture(name), cwd: indexedProject() });
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: event, additionalContext: SESSION_TEXT },
    });
  });

  test(`${event} outside an indexed project is silent`, () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bare-'));
    assert.strictEqual(runHook({ ...fixture(name), cwd: bare }).stdout, '');
  });

  if (event === 'SubagentStart') {
    test(`${event} without an ak: key is silent`, () => {
      const input = { ...fixture(name), cwd: indexedProject() };
      assert.strictEqual(runHook(input, { key: '' }).stdout, '');
      assert.strictEqual(runHook(input, { key: 'sk:test' }).stdout, '');
    });
  }
}

test('SessionStart startup without an ak: key emits the setup message', () => {
  const input = { ...fixture('session-start.json'), source: 'startup', cwd: indexedProject() };
  for (const key of ['', 'sk:test']) {
    const result = runHook(input, { key });
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(JSON.parse(result.stdout), { systemMessage: MISSING_KEY_MESSAGE });
  }
  assert.match(MISSING_KEY_MESSAGE, /\$constellation:get-started/);
});

test('SessionStart on resume, clear, and compact without a key is silent', () => {
  for (const source of ['resume', 'clear', 'compact']) {
    const input = { ...fixture('session-start.json'), source, cwd: indexedProject() };
    assert.strictEqual(runHook(input, { key: '' }).stdout, '');
  }
});

test('SessionStart startup in a git repo without constellation.json says the project is not indexed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-repo-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const nested = path.join(repo, 'src');
  fs.mkdirSync(nested);
  const input = { ...fixture('session-start.json'), source: 'startup', cwd: nested };
  assert.deepStrictEqual(JSON.parse(runHook(input).stdout), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: NOT_INDEXED_TEXT },
  });
  assert.strictEqual(runHook({ ...input, source: 'resume' }).stdout, '');
});

test('SessionStart startup in an indexed project emits only the session text', () => {
  const input = { ...fixture('session-start.json'), source: 'startup', cwd: indexedProject() };
  assert.deepStrictEqual(JSON.parse(runHook(input).stdout), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: SESSION_TEXT },
  });
});

test('other events and malformed stdin are silent', () => {
  const cwd = indexedProject();
  assert.strictEqual(runHook({ hook_event_name: 'Stop', cwd }).stdout, '');
  const result = runHook('not json');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('SessionStart prunes session state older than seven days', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));
  const sessions = path.join(data, 'sessions');
  fs.mkdirSync(sessions);
  const old = path.join(sessions, 'old.json');
  const fresh = path.join(sessions, 'fresh.json');
  fs.writeFileSync(old, '{}');
  fs.writeFileSync(fresh, '{}');
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, eightDaysAgo, eightDaysAgo);
  runHook({ ...fixture('session-start.json'), cwd: indexedProject() }, { data });
  assert.strictEqual(fs.existsSync(old), false);
  assert.strictEqual(fs.existsSync(fresh), true);
});

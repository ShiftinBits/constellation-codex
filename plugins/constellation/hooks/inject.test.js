'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { ADDITIONAL_CONTEXT, buildHookOutput } = require('./inject');

const HOOK = path.join(__dirname, 'inject.js');

function runHook(args, stdin, key) {
  const env = { ...process.env };
  delete env.CONSTELLATION_ACCESS_KEY;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  return spawnSync(process.execPath, [HOOK, ...args], { input: stdin, env, encoding: 'utf8' });
}

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('SessionStart fixture with an ak: key emits session guidance', () => {
  const result = runHook([], fixture('session-start.json'), 'ak:test');
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ADDITIONAL_CONTEXT.SessionStart },
  });
});

test('argv event name is the fallback when stdin is empty', () => {
  const result = runHook(['SessionStart'], '', 'ak:test');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('no key produces no output', () => {
  const result = runHook([], fixture('session-start.json'));
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('a non-ak: key produces no output', () => {
  assert.strictEqual(runHook([], fixture('session-start.json'), 'sk:test').stdout, '');
});

test('malformed stdin without argv produces no output', () => {
  const result = runHook([], 'not json', 'ak:test');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('buildHookOutput returns null for unknown events', () => {
  assert.strictEqual(buildHookOutput('Nope'), null);
});

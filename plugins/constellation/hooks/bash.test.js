'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { ADDITIONAL_CONTEXT } = require('./inject');

const HOOK = path.join(__dirname, 'bash.js');

function runHook(stdin, key) {
  const env = { ...process.env };
  delete env.CONSTELLATION_ACCESS_KEY;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  return spawnSync(process.execPath, [HOOK], { input: stdin, env, encoding: 'utf8' });
}

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('a grep command with an ak: key emits the nudge', () => {
  const result = runHook(fixture('pre-tool-use-bash.json'), 'ak:test');
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ADDITIONAL_CONTEXT.PreToolUse },
  });
});

test('a non-search command emits nothing', () => {
  assert.strictEqual(runHook(fixture('pre-tool-use-bash-plain.json'), 'ak:test').stdout, '');
});

test('no key emits nothing', () => {
  assert.strictEqual(runHook(fixture('pre-tool-use-bash.json')).stdout, '');
});

test('malformed stdin emits nothing', () => {
  const result = runHook('not json', 'ak:test');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('other tools emit nothing', () => {
  const input = JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: 'grep x' } });
  assert.strictEqual(runHook(input, 'ak:test').stdout, '');
});

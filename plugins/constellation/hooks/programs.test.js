'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PROGRAMS } = require('./programs');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Every mcp_tool entry in hooks.json with its `<event>:<matcher>` key. */
function mcpToolEntries() {
  const entries = [];
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        if (handler.type === 'mcp_tool') entries.push({ key: `${event}:${group.matcher}`, handler });
      }
    }
  }
  return entries;
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The `hook` global hook mode builds for `event` from the entry's template:
 * each full-value placeholder replaced by the event field it names (as Codex
 * expands it), and the requested settings resolved from `env`.
 */
function hookFor(key, event, env = {}) {
  const { handler } = mcpToolEntries().find((entry) => entry.key === key);
  const resolve = (value) => {
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    }
    const placeholder = typeof value === 'string' && /^\$\{([^{}]+)\}$/.exec(value);
    if (!placeholder) return value;
    const resolved = placeholder[1].split('.').reduce((v, field) => (v === undefined ? undefined : v[field]), event);
    assert.notStrictEqual(resolved, undefined, `placeholder ${value} is missing from the event`);
    return resolved;
  };
  const template = resolve(handler.input.hook);
  const settings = Object.fromEntries(template.settings.map((name) => [name, env[name]]));
  return deepFreeze({ ...template, settings, once: () => true });
}

/** A stub api whose searchSymbols answers with `answer(params)` and records each call. */
function stubApi(answer = () => []) {
  const calls = [];
  const api = {
    searchSymbols: async (params) => {
      calls.push(params);
      return { symbols: await answer(params) };
    },
  };
  return { api: Object.freeze(api), calls };
}

const ADVISORY_KEYS = ['context', 'message'];

/** Runs the program literal for `key` and checks the result is null or advisory output only. */
async function run(key, hook, api) {
  const result = await new AsyncFunction('api', 'hook', PROGRAMS[key])(api, hook);
  if (result !== null) {
    assert.strictEqual(typeof result, 'object');
    for (const field of Object.keys(result)) assert.ok(ADVISORY_KEYS.includes(field), `unexpected output field ${field}`);
  }
  return result;
}

const ON = { CONSTELLATION_AUGMENT_SEARCH: '1' };

function bashEvent(command, extra = {}) {
  return { ...fixture('post-tool-use-bash-search.json'), tool_input: { command }, ...extra };
}

const userService = { name: 'UserService', kind: 'class', filePath: 'src/user.service.ts', line: 12, usageCount: 7 };

test('every mcp_tool entry runs the PROGRAMS literal for its key', () => {
  const entries = mcpToolEntries();
  for (const { key, handler } of entries) {
    assert.ok(key in PROGRAMS, `no program for ${key}`);
    assert.strictEqual(handler.input.code, PROGRAMS[key], `hooks.json ${key} code is stale; expected:\n${JSON.stringify(PROGRAMS[key])}`);
  }
  for (const key of Object.keys(PROGRAMS)) {
    assert.strictEqual(entries.filter((entry) => entry.key === key).length, 1, `program ${key} needs exactly one mcp_tool entry`);
  }
});

test('every mcp_tool entry targets code_intel with a bounded timeout and full-value placeholders', () => {
  for (const { handler } of mcpToolEntries()) {
    assert.strictEqual(handler.server, 'constellation');
    assert.strictEqual(handler.tool, 'code_intel');
    assert.strictEqual(handler.timeout, 3);
    assert.strictEqual(handler.input.cwd, '${cwd}');
    assert.strictEqual(handler.input.hook.sessionId, '${session_id}');
  }
});

test('every program literal is under 100 KB and holds no placeholder sequence', () => {
  for (const [key, code] of Object.entries(PROGRAMS)) {
    assert.ok(Buffer.byteLength(code) < 100 * 1024, `${key} program is ${Buffer.byteLength(code)} bytes`);
    assert.doesNotMatch(code, /\$\{/, `${key} program contains a placeholder sequence`);
  }
});

test('every setting a program reads is passed to the MCP server', () => {
  const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
  const envVars = mcp.mcpServers.constellation.env_vars;
  for (const { handler } of mcpToolEntries()) {
    for (const name of handler.input.hook.settings) assert.ok(envVars.includes(name), `${name} is missing from .mcp.json env_vars`);
  }
});

test('the template delivers the Bash command as hook.input.tool_input.command', () => {
  const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService'), ON);
  assert.strictEqual(hook.event, 'PostToolUse');
  assert.strictEqual(hook.sessionId, 'sess-abc123');
  assert.deepStrictEqual(hook.input, { tool_name: 'Bash', tool_input: { command: 'rg UserService' }, cwd: '/tmp/example-project' });
});

for (const value of [undefined, '0', 'false', '']) {
  test(`augment is off without an api call when CONSTELLATION_AUGMENT_SEARCH is ${JSON.stringify(value)}`, async () => {
    const { api, calls } = stubApi(() => [userService]);
    const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService'), { CONSTELLATION_AUGMENT_SEARCH: value });
    assert.strictEqual(await run('PostToolUse:Bash', hook, api), null);
    assert.strictEqual(calls.length, 0);
  });
}

test('augment accepts CONSTELLATION_AUGMENT_SEARCH=true', async () => {
  const { api } = stubApi(() => [userService]);
  const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService'), { CONSTELLATION_AUGMENT_SEARCH: 'true' });
  assert.notStrictEqual(await run('PostToolUse:Bash', hook, api), null);
});

test('augment ignores a tool other than Bash', async () => {
  const { api, calls } = stubApi(() => [userService]);
  const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService', { tool_name: 'apply_patch' }), ON);
  assert.strictEqual(await run('PostToolUse:Bash', hook, api), null);
  assert.strictEqual(calls.length, 0);
});

for (const command of [
  'rg "connection refused"',
  "grep -rnE '[A-Z]+Service' src",
  'grep -r "user.service" .',
  'ls -la',
  'cat src/user.ts | grep UserService',
  'rg',
]) {
  test(`augment makes no api call for ${command}`, async () => {
    const { api, calls } = stubApi(() => [userService]);
    assert.strictEqual(await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent(command), ON), api), null);
    assert.strictEqual(calls.length, 0);
  });
}

for (const [command, symbol] of [
  [fixture('post-tool-use-bash-search.json').tool_input.command, 'UserService'],
  ['rg -t ts UserService src', 'UserService'],
  ['rg --type ts -g "*.ts" -A 2 UserService', 'UserService'],
  ['git grep -n "class UserService"', 'UserService'],
  ["grep -rn -e 'createUser\\(' src", 'createUser'],
  ['grep --regexp=createUser src', 'createUser'],
  ["cd packages/api && rg '\\bUserService\\b'", 'UserService'],
  ['rg UserService src | head -5', 'UserService'],
  ['egrep -rn "def load_config" .', 'load_config'],
]) {
  test(`augment looks up ${symbol} for ${command}`, async () => {
    const { api, calls } = stubApi(() => []);
    await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent(command), ON), api);
    assert.ok(calls.length > 0);
    for (const params of calls) assert.strictEqual(params.query, symbol);
  });
}

test('augment reports the most used exported exact match', async () => {
  const { api, calls } = stubApi((params) =>
    params.isExported
      ? [
          { name: 'UserServiceImpl', kind: 'class', filePath: 'src/impl.ts', line: 3, usageCount: 40 },
          { ...userService, filePath: 'src/legacy.ts', usageCount: 2 },
          userService,
        ]
      : [],
  );
  const result = await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService'), ON), api);
  assert.deepStrictEqual(result, {
    context:
      '`UserService` (class) defined at `src/user.service.ts:12`, 7 usages. code_intel api.traceSymbolUsage lists every usage.',
  });
  assert.deepStrictEqual(calls, [{ query: 'UserService', limit: 100, includeUsageCount: true, isExported: true }]);
});

test('augment falls back to a used symbol that is not exported', async () => {
  const { api, calls } = stubApi((params) =>
    params.isExported
      ? []
      : [
          { name: 'parseLine', kind: 'function', filePath: 'test/fixture.ts', line: 1, usageCount: 0 },
          { name: 'parseLine', kind: 'function', filePath: 'src/parse.ts', line: 30, usageCount: 1 },
        ],
  );
  const result = await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg parseLine'), ON), api);
  assert.deepStrictEqual(result, {
    context: '`parseLine` (function) defined at `src/parse.ts:30`, 1 usage. code_intel api.traceSymbolUsage lists every usage.',
  });
  assert.deepStrictEqual(calls, [
    { query: 'parseLine', limit: 100, includeUsageCount: true, isExported: true },
    { query: 'parseLine', limit: 100, includeUsageCount: true },
  ]);
});

test('augment returns null with no exact match', async () => {
  const { api } = stubApi((params) =>
    params.isExported
      ? [{ name: 'UserServiceImpl', kind: 'class', filePath: 'src/impl.ts', line: 3, usageCount: 40 }]
      : [{ ...userService, usageCount: 0 }],
  );
  assert.strictEqual(await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService'), ON), api), null);
});

test('augment rejects when the api throws, which hook mode turns into a quiet {}', async () => {
  const { api } = stubApi(() => {
    throw new Error('unavailable');
  });
  await assert.rejects(run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService'), ON), api), /unavailable/);
});

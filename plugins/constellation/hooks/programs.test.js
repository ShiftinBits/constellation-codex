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

const IMPACT = 'PreToolUse:apply_patch|Edit|Write';
const IMPACT_ON = { CONSTELLATION_IMPACT_NOTICE: '1' };

function patchEvent(command, extra = {}) {
  return { ...fixture('pre-tool-use-apply-patch.json'), tool_input: { command }, ...extra };
}

/** A stub api whose getDependents answers with `answer(params)` and records each call. */
function dependentsApi(answer) {
  const calls = [];
  const api = Object.freeze({
    getDependents: async (params) => {
      calls.push(params);
      return { directDependents: await answer(params) };
    },
  });
  return { api, calls };
}

const dependentsList = (count, extra = {}) =>
  Array.from({ length: count }, (_, i) => ({ filePath: `src/dep${i}.ts`, usedSymbols: [`sym${i}`], ...extra }));

test('impact reads the paths a patch updates, deletes or moves to and not those it adds', async () => {
  const { api, calls } = dependentsApi(() => []);
  await run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), IMPACT_ON), api);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/user.service.ts', 'src/legacy.ts', 'src/old-name.ts', 'src/new-name.ts'],
  );
  for (const params of calls) assert.deepStrictEqual(Object.keys(params).sort(), ['filePath', 'includeSymbols', 'limit']);
  assert.ok(calls.every((params) => params.limit === 100 && params.includeSymbols === true));
});

test('impact makes paths relative to cwd, dedupes them and skips those outside it', async () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: /tmp/example-project/src/a.ts',
    '*** Update File: src/./a.ts',
    '*** Delete File: src/sub/../b.ts',
    '*** Update File: ../elsewhere/c.ts',
    '*** Update File: /etc/passwd',
    '*** Update File: /tmp/example-project-other/d.ts',
    '*** Add File: src/e.ts',
    '*** End Patch',
  ].join('\n');
  const { api, calls } = dependentsApi(() => []);
  await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/a.ts', 'src/b.ts'],
  );
});

for (const value of [undefined, '', '0', 'false', 'yes']) {
  test(`impact makes no api call when CONSTELLATION_IMPACT_NOTICE is ${JSON.stringify(value)}`, async () => {
    const { api, calls } = dependentsApi(() => dependentsList(60));
    const hook = hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), { CONSTELLATION_IMPACT_NOTICE: value });
    assert.strictEqual(await run(IMPACT, hook, api), null);
    assert.strictEqual(calls.length, 0);
  });
}

test('impact accepts CONSTELLATION_IMPACT_NOTICE=true', async () => {
  const { api } = dependentsApi(() => dependentsList(20));
  const hook = hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), { CONSTELLATION_IMPACT_NOTICE: 'true' });
  assert.notStrictEqual(await run(IMPACT, hook, api), null);
});

test('impact makes no api call for a patch without paths or a command without text', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(60));
  const onlyAdd = patchEvent('*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch\n');
  assert.strictEqual(await run(IMPACT, hookFor(IMPACT, onlyAdd, IMPACT_ON), api), null);
  const noCommand = { ...fixture('pre-tool-use-apply-patch.json'), tool_input: { file_path: 'src/a.ts' } };
  assert.strictEqual(await run(IMPACT, hookFor(IMPACT, noCommand, IMPACT_ON), api), null);
  assert.strictEqual(calls.length, 0);
});

test('impact reports a high risk file with its dependents, symbols and tests', async () => {
  const { api } = dependentsApi(() => [
    ...dependentsList(18),
    { filePath: 'src/user.service.spec.ts', usedSymbols: ['a'] },
    { filePath: 'test/user.ts' },
  ]);
  const patch = '*** Begin Patch\n*** Update File: src/user.service.ts\n@@\n*** End Patch\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api);
  assert.strictEqual(result.message, 'src/user.service.ts: high risk, 20 dependents');
  assert.match(result.context, /`src\/user\.service\.ts`: high risk, 20 dependents/);
  assert.match(result.context, /e\.g\. `src\/dep0\.ts`, `src\/dep1\.ts`, `src\/dep2\.ts`;/);
  assert.match(result.context, /used symbols: sym0, sym1, sym2, sym3, sym4, sym5, sym6, sym7, sym8, sym9; 2 test dependents/);
  assert.doesNotMatch(result.context, /sym10/);
  assert.match(result.context, /api\.impactAnalysis or api\.traceSymbolUsage/);
  assert.ok(result.context.length < 8000);
});

test('impact reports critical risk and 100+ for a full page', async () => {
  const { api } = dependentsApi(() => dependentsList(100));
  const patch = '*** Begin Patch\n*** Delete File: src/core.ts\n*** End Patch\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api);
  assert.strictEqual(result.message, 'src/core.ts: critical risk, 100+ dependents');
  assert.match(result.context, /critical risk, 100\+ dependents/);
});

test('impact summarizes several risky files and keeps the message to one line', async () => {
  const { api } = dependentsApi((params) => (params.filePath === 'src/small.ts' ? dependentsList(2) : dependentsList(25)));
  const patch = '*** Update File: src/a.ts\n*** Update File: src/small.ts\n*** Delete File: src/b.ts\n*** Update File: src/c.ts\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api);
  assert.strictEqual(result.message, 'src/a.ts: high risk, 25 dependents (+2 more)');
  assert.doesNotMatch(result.message, /\n/);
  assert.doesNotMatch(result.context, /small\.ts/);
});

const IMPACT_FOOTER = 'Before changing behavior, run code_intel api.impactAnalysis or api.traceSymbolUsage on the affected symbols.';

/** A once that claims each key a single time, recording the keys it claims. */
function claimingOnce(claimed = new Set()) {
  const keys = [];
  const once = (key) => {
    if (claimed.has(key)) return false;
    claimed.add(key);
    keys.push(key);
    return true;
  };
  return { once, keys };
}

const pathOfKey = (key) => key.slice('impact:'.length);

test('impact keeps the context well under the limit for many large files and lists every file it claims', async () => {
  const long = (i) => ({ filePath: `src/${'d'.repeat(150)}${i}.ts`, usedSymbols: Array.from({ length: 30 }, (_, j) => `symbol${i}x${j}`) });
  const { api, calls } = dependentsApi(() => Array.from({ length: 100 }, (_, i) => long(i)));
  const patch = Array.from({ length: 100 }, (_, i) => `*** Update File: src/f${i}.ts`).join('\n');
  const { once, keys } = claimingOnce();
  const result = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch), IMPACT_ON), once }, api);
  assert.ok(result.context.length <= 6000);
  assert.ok(result.context.endsWith('\n' + IMPACT_FOOTER));
  assert.ok(calls.length <= 50);
  assert.strictEqual(calls.length, keys.length);
  const listed = result.context.split('\n').filter((line) => line.startsWith('- '));
  assert.strictEqual(listed.length, keys.length);
  for (const key of keys) assert.ok(result.context.includes('- `' + pathOfKey(key) + '`: critical risk'), `${key} is claimed but not listed`);
  assert.ok(result.message.endsWith(' (+' + (keys.length - 1) + ' more)'));
  assert.match(listed[0], /e\.g\. /);
  assert.doesNotMatch(listed[listed.length - 1], /e\.g\. |used symbols/);
});

test('impact leaves a file whose line does not fit unclaimed so a later patch reports it', async () => {
  const { api } = dependentsApi(() => dependentsList(30));
  const files = Array.from({ length: 20 }, (_, i) => `src/${'p'.repeat(400)}${i}.ts`);
  const patch = files.map((file) => `*** Update File: ${file}`).join('\n');
  const claimed = new Set();
  const listedPaths = (result) =>
    result.context
      .split('\n')
      .filter((line) => line.startsWith('- `'))
      .map((line) => line.slice(3, line.indexOf('`', 3)));

  const first = claimingOnce(claimed);
  const firstResult = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch), IMPACT_ON), once: first.once }, api);
  assert.ok(firstResult.context.length <= 6000);
  assert.ok(firstResult.context.endsWith('\n' + IMPACT_FOOTER));
  assert.ok(first.keys.length > 0 && first.keys.length < files.length);
  assert.deepStrictEqual(listedPaths(firstResult), first.keys.map(pathOfKey));
  assert.ok(firstResult.message.endsWith(' (+' + (first.keys.length - 1) + ' more)'));

  const second = claimingOnce(claimed);
  const secondResult = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch), IMPACT_ON), once: second.once }, api);
  assert.ok(secondResult.context.endsWith('\n' + IMPACT_FOOTER));
  assert.deepStrictEqual(listedPaths(secondResult), second.keys.map(pathOfKey));
  assert.deepStrictEqual([...listedPaths(firstResult), ...listedPaths(secondResult)].sort(), [...files].sort());
});

test('impact returns null for low and medium risk files', async () => {
  for (const count of [0, 4, 5, 19]) {
    const { api } = dependentsApi(() => dependentsList(count));
    const patch = '*** Update File: src/a.ts\n';
    assert.strictEqual(await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api), null);
  }
});

test('impact skips a file whose once key was already taken', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(30));
  const keys = [];
  const hook = { ...hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), IMPACT_ON), once: (key) => (keys.push(key), key !== 'impact:src/legacy.ts') };
  await run(IMPACT, hook, api);
  assert.deepStrictEqual(keys, ['impact:src/user.service.ts', 'impact:src/legacy.ts', 'impact:src/old-name.ts', 'impact:src/new-name.ts']);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/user.service.ts', 'src/old-name.ts', 'src/new-name.ts'],
  );
});

test('impact returns null when every file was already reported', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(30));
  const hook = { ...hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), IMPACT_ON), once: () => false };
  assert.strictEqual(await run(IMPACT, hook, api), null);
  assert.strictEqual(calls.length, 0);
});

test('impact counts a file that is not in the graph as zero dependents', async () => {
  const { api } = dependentsApi((params) => {
    if (params.filePath === 'src/user.service.ts') {
      const error = new Error('File not found in the graph: src/user.service.ts');
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }
    return dependentsList(30);
  });
  const result = await run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), IMPACT_ON), api);
  assert.doesNotMatch(result.context, /user\.service\.ts/);
  assert.match(result.context, /src\/legacy\.ts/);
});

test('impact rejects when the api throws, which hook mode turns into a quiet {}', async () => {
  const { api } = dependentsApi(() => {
    throw new Error('unavailable');
  });
  await assert.rejects(run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json'), IMPACT_ON), api), /unavailable/);
});

test('impact output holds only context and message and no source text', async () => {
  const { api } = dependentsApi(() => dependentsList(30));
  const patch = '*** Update File: src/a.ts\n@@\n-const secret = 1;\n+const secret = 2;\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch), IMPACT_ON), api);
  assert.deepStrictEqual(Object.keys(result).sort(), ['context', 'message']);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

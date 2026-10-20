'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { bashSearch, symbolOf } = require('./classify');
const { PROGRAMS } = require('./programs');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const optIn = readJson(path.join(__dirname, 'opt-in-hooks.json'));
const fixture = (name) => readJson(path.join(__dirname, 'fixtures', name));

/** Every mcp_tool entry in a hooks file (opt-in-hooks.json by default) with its `<event>:<matcher>` key. */
function mcpToolEntries(manifest = optIn) {
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
 * expands it). The template requests no settings, so hook mode passes none.
 */
function hookFor(key, event) {
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
  return deepFreeze({ ...resolve(handler.input.hook), settings: {}, once: () => true });
}

/** A stub api whose searchSymbols answers with `answer(params)` and records each call as JSON, as the sandbox sends it. */
function stubApi(answer = () => []) {
  const calls = [];
  const api = {
    searchSymbols: async (params) => {
      calls.push(JSON.parse(JSON.stringify(params)));
      return { symbols: await answer(params) };
    },
  };
  return { api: Object.freeze(api), calls };
}

const ADVISORY_KEYS = ['context', 'message'];

/**
 * Runs the program literal for `key` in a context with no globals but the
 * language built-ins, so a reference to process, Buffer, console, setTimeout or
 * require throws. V8 gives every context a console, so it is shadowed: hook
 * mode only captures console output, which no one reads. The hook is frozen,
 * as hook mode's is. Checks the result is null or advisory output only and
 * returns it as JSON, as hook mode passes it on.
 */
async function run(key, hook, api) {
  const globals = Object.assign(Object.create(null), { console: undefined });
  const program = vm.runInNewContext(`(async function (api, hook) {\n${PROGRAMS[key]}\n})`, globals);
  const result = await program(api, Object.freeze(hook));
  if (result === null) return null;
  assert.strictEqual(typeof result, 'object');
  for (const field of Object.keys(result)) assert.ok(ADVISORY_KEYS.includes(field), `unexpected output field ${field}`);
  return JSON.parse(JSON.stringify(result));
}

function bashEvent(command, extra = {}) {
  return { ...fixture('post-tool-use-bash-search.json'), tool_input: { command }, ...extra };
}

const userService = { name: 'UserService', kind: 'class', filePath: 'src/user.service.ts', line: 12, usageCount: 7 };

test('the plugin hooks.json registers no mcp_tool hook, so they cost nothing until a user adds them', () => {
  assert.deepStrictEqual(mcpToolEntries(readJson(path.join(__dirname, 'hooks.json'))), []);
  const plugin = readJson(path.join(__dirname, '..', '.codex-plugin', 'plugin.json'));
  assert.strictEqual(plugin.hooks, './hooks/hooks.json');
});

test('opt-in-hooks.json has only the top-level fields a Codex hooks.json accepts', () => {
  assert.deepStrictEqual(Object.keys(optIn).sort(), ['description', 'hooks']);
});

test('every mcp_tool entry runs the PROGRAMS literal for its key', () => {
  const entries = mcpToolEntries();
  for (const { key, handler } of entries) {
    assert.ok(key in PROGRAMS, `no program for ${key}`);
    assert.strictEqual(handler.input.code, PROGRAMS[key], `opt-in-hooks.json ${key} code is stale; expected:\n${JSON.stringify(PROGRAMS[key])}`);
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

test('no mcp_tool entry requests settings, since adding the hook is the opt-in', () => {
  for (const { handler } of mcpToolEntries()) assert.ok(!('settings' in handler.input.hook));
});

test('the template delivers the Bash command as hook.input.tool_input.command', () => {
  const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService'));
  assert.strictEqual(hook.event, 'PostToolUse');
  assert.strictEqual(hook.sessionId, 'sess-abc123');
  assert.deepStrictEqual(hook.input, { tool_name: 'Bash', tool_input: { command: 'rg UserService' }, cwd: '/tmp/example-project' });
});

test('augment ignores a tool other than Bash', async () => {
  const { api, calls } = stubApi(() => [userService]);
  const hook = hookFor('PostToolUse:Bash', bashEvent('rg UserService', { tool_name: 'apply_patch' }));
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
  "cd packages/api && rg '\\bUserService\\b'",
  'cd packages/api ; rg UserService',
  'git -C packages/api grep UserService',
  'rg TODO',
  'grep -rn FIXME src',
  'rg MAX_RETRIES',
  'rg AKIAIOSFODNN7EXAMPLE',
  'rg import',
  'grep -rn "export" src',
  'grep -- -e src',
]) {
  test(`augment makes no api call for ${command}`, async () => {
    const { api, calls } = stubApi(() => [userService]);
    assert.strictEqual(await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent(command)), api), null);
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
  ['rg UserService src | head -5', 'UserService'],
  ['egrep -rn "def load_config" .', 'load_config'],
  ['grep -rn --exclude-dir dist UserService .', 'UserService'],
  ['grep --max-count 5 UserService src', 'UserService'],
  ['rg --type-not js --max-depth 2 UserService', 'UserService'],
  ['rg -eUserService src', 'UserService'],
  ['grep -rn -- UserService src', 'UserService'],
  ['LC_ALL=C grep -rn UserService .', 'UserService'],
]) {
  test(`augment looks up ${symbol} for ${command}`, async () => {
    const { api, calls } = stubApi(() => []);
    await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent(command)), api);
    assert.ok(calls.length > 0);
    for (const params of calls) assert.strictEqual(params.query, symbol);
  });
}

/**
 * Search lines on which augment must find the same symbol as the nudge in
 * classify.js, since augment carries its own copy of the parsing rules.
 */
const PARITY = [
  'grep Foo .', 'grep -rn fooBar src/', 'grep -e fooBar .', 'grep -rn --regexp fooBar .', 'grep --regexp=fooBar .',
  'grep -A 3 -e fooBar .', 'egrep fooBar .', 'rg AuthService src/', 'ag fooBar', 'ack fooBar', 'git grep fooBar',
  'git grep -n fooBar -- src', 'grep "connection refused" .', "rg '\\bFoo\\b' src", 'rg "class UserService"',
  "rg 'a|b' src", 'grep fooBar . | head', 'grep fooBar . ; ls', 'grep fooBar . && ls', 'grep fooBar . || true',
  'cat log.txt | grep ERROR', 'ls && grep fooBar .', 'echo hi; rg fooBar', 'git log fooBar', 'ls -la', '', 'grep',
  'grep -rn', 'grep -e', "grep 'unterminated Foo", 'grep -r AuthService .', 'grep -eAuthService .',
  'rg -t ts AuthService src', 'rg --type ts AuthService', 'rg --type=ts AuthService', "rg -g '*.ts' AuthService",
  "grep --include '*.ts' -rn AuthService .", 'rg -m 1 AuthService', 'rg -- -dashed src', 'rg -t ts',
  'LC_ALL=C grep -rn fooBar .', 'FOO=1 BAR=2 rg fooBar', 'rg TODO', 'rg import', 'rg MAX_RETRIES',
  'rg -r X AuthService src', 'rg -T js AuthService', 'rg -E latin1 AuthService', 'rg --encoding latin1 AuthService',
  'grep -E Auth src', 'grep -T AuthService src', 'grep "say \\"hi\\" | x" src', 'rg Auth\\Service',
  'rg \\"AuthService\\"', 'rg \\\n  AuthService src', "grep -rn -e 'createUser\\(' src",
];

for (const command of PARITY) {
  test(`augment looks up what classify.js finds for ${JSON.stringify(command)}`, async () => {
    const { api, calls } = stubApi(() => []);
    await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent(command)), api);
    const search = bashSearch(command);
    assert.strictEqual(calls.length === 0 ? null : calls[0].query, search === null ? null : symbolOf(search.pattern));
  });
}

test('augment reports the most used exported exact match from one search', async () => {
  const { api, calls } = stubApi(() => [
    { name: 'UserServiceImpl', kind: 'class', filePath: 'src/impl.ts', line: 3, usageCount: 40, isExported: true },
    { ...userService, filePath: 'src/local.ts', usageCount: 30, isExported: false },
    { ...userService, filePath: 'src/legacy.ts', usageCount: 2, isExported: true },
    { ...userService, isExported: true },
  ]);
  const result = await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService')), api);
  assert.deepStrictEqual(result, {
    context:
      '`UserService` (class) defined at `src/user.service.ts:12`, 7 usages. code_intel api.traceSymbolUsage lists every usage.',
  });
  assert.deepStrictEqual(calls, [{ query: 'UserService', limit: 100, includeUsageCount: true }]);
});

test('augment reports a symbol once per session and still looks up another', async () => {
  const { api, calls } = stubApi(() => [userService, { ...userService, name: 'parseLine' }]);
  const { once, keys } = claimingOnce();
  const search = (command) => run('PostToolUse:Bash', { ...hookFor('PostToolUse:Bash', bashEvent(command)), once }, api);
  assert.notStrictEqual(await search('rg UserService'), null);
  assert.strictEqual(await search('grep -rn UserService src'), null);
  assert.strictEqual(calls.length, 1);
  assert.notStrictEqual(await search('rg parseLine'), null);
  assert.deepStrictEqual(keys, ['augment:UserService', 'augment:parseLine']);
});

test('augment skips a symbol whose once key hook mode would reject', async () => {
  const { api, calls } = stubApi(() => []);
  const { once, keys } = claimingOnce();
  const atLimit = 'a'.repeat(256 - 'augment:'.length);
  const overLimit = 'b'.repeat(256 - 'augment:'.length + 1);
  const search = (command) => run('PostToolUse:Bash', { ...hookFor('PostToolUse:Bash', bashEvent(command)), once }, api);
  assert.strictEqual(await search('rg ' + overLimit), null);
  assert.strictEqual(calls.length, 0);
  await search('rg ' + atLimit);
  assert.deepStrictEqual(keys, ['augment:' + atLimit]);
  assert.ok(calls.length > 0);
});

test('augment falls back to a used symbol that is not exported', async () => {
  const { api, calls } = stubApi(() => [
    { name: 'parseLine', kind: 'function', filePath: 'test/fixture.ts', line: 1, usageCount: 0, isExported: false },
    { name: 'parseLine', kind: 'function', filePath: 'src/parse.ts', line: 30, usageCount: 1, isExported: false },
  ]);
  const result = await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg parseLine')), api);
  assert.deepStrictEqual(result, {
    context: '`parseLine` (function) defined at `src/parse.ts:30`, 1 usage. code_intel api.traceSymbolUsage lists every usage.',
  });
  assert.deepStrictEqual(calls, [{ query: 'parseLine', limit: 100, includeUsageCount: true }]);
});

test('augment returns null with no exact match', async () => {
  const { api } = stubApi(() => [
    { name: 'UserServiceImpl', kind: 'class', filePath: 'src/impl.ts', line: 3, usageCount: 40, isExported: true },
    { ...userService, usageCount: 0, isExported: false },
  ]);
  assert.strictEqual(await run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService')), api), null);
});

test('augment rejects when the api throws, which hook mode turns into a quiet {}', async () => {
  const { api } = stubApi(() => {
    throw new Error('unavailable');
  });
  await assert.rejects(run('PostToolUse:Bash', hookFor('PostToolUse:Bash', bashEvent('rg UserService')), api), /unavailable/);
});

const IMPACT = 'PreToolUse:apply_patch|Edit|Write';

function patchEvent(command, extra = {}) {
  return { ...fixture('pre-tool-use-apply-patch.json'), tool_input: { command }, ...extra };
}

test('the template delivers the patch as hook.input.tool_input.command', () => {
  const event = fixture('pre-tool-use-apply-patch.json');
  const hook = hookFor(IMPACT, event);
  assert.strictEqual(hook.event, 'PreToolUse');
  assert.strictEqual(hook.sessionId, 'sess-abc123');
  assert.deepStrictEqual(hook.input, { tool_name: 'apply_patch', tool_input: event.tool_input, cwd: '/tmp/example-project' });
});

/** A stub api whose getDependents answers with `answer(params)` and records each call as JSON, as the sandbox sends it. */
function dependentsApi(answer) {
  const calls = [];
  const api = Object.freeze({
    getDependents: async (params) => {
      calls.push(JSON.parse(JSON.stringify(params)));
      return { directDependents: await answer(params) };
    },
  });
  return { api, calls };
}

const dependentsList = (count, extra = {}) =>
  Array.from({ length: count }, (_, i) => ({ filePath: `src/dep${i}.ts`, usedSymbols: [`sym${i}`], ...extra }));

test('impact reads the paths a patch updates, deletes or moves to and not those it adds', async () => {
  const { api, calls } = dependentsApi(() => []);
  await run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json')), api);
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
  await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/a.ts', 'src/b.ts'],
  );
});

test('impact makes no api call for a patch without paths or a command without text', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(60));
  const onlyAdd = patchEvent('*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch\n');
  assert.strictEqual(await run(IMPACT, hookFor(IMPACT, onlyAdd), api), null);
  const noCommand = { ...fixture('pre-tool-use-apply-patch.json'), tool_input: { file_path: 'src/a.ts' } };
  assert.strictEqual(await run(IMPACT, hookFor(IMPACT, noCommand), api), null);
  assert.strictEqual(calls.length, 0);
});

test('impact reports a high risk file with its dependents, symbols and tests', async () => {
  const { api } = dependentsApi(() => [
    ...dependentsList(18),
    { filePath: 'src/user.service.spec.ts', usedSymbols: ['a'] },
    { filePath: 'test/user.ts' },
  ]);
  const patch = '*** Begin Patch\n*** Update File: src/user.service.ts\n@@\n*** End Patch\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
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
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.strictEqual(result.message, 'src/core.ts: critical risk, 100+ dependents');
  assert.match(result.context, /critical risk, 100\+ dependents/);
});

test('impact gives the test count of a full page as a lower bound', async () => {
  const page = [...dependentsList(80), ...Array.from({ length: 20 }, (_, i) => ({ filePath: `test/t${i}.spec.ts` }))];
  const { api } = dependentsApi(() => page);
  const patch = '*** Update File: src/core.ts\n';
  const full = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.match(full.context, /; 20\+ test dependents\n/);
  const partial = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), dependentsApi(() => page.slice(1)).api);
  assert.match(partial.context, /; 20 test dependents\n/);
});

test('impact reads patch headers that are indented', async () => {
  const { api, calls } = dependentsApi(() => []);
  const patch = [
    '*** Begin Patch',
    '  *** Update File: src/a.ts',
    '\t*** Delete File: src/b.ts',
    ' *** Update File: src/c.ts',
    '   *** Move to: src/d.ts',
    '  *** Add File: src/e.ts',
    '*** End Patch',
  ].join('\n');
  await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
  );
});

test('impact summarizes several risky files and keeps the message to one line', async () => {
  const { api } = dependentsApi((params) => (params.filePath === 'src/small.ts' ? dependentsList(2) : dependentsList(25)));
  const patch = '*** Update File: src/a.ts\n*** Update File: src/small.ts\n*** Delete File: src/b.ts\n*** Update File: src/c.ts\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.strictEqual(result.message, 'src/a.ts: high risk, 25 dependents (+2 more)');
  assert.doesNotMatch(result.message, /\n/);
  assert.doesNotMatch(result.context, /small\.ts/);
});

const IMPACT_FOOTER = 'Before changing behavior, run code_intel api.impactAnalysis or api.traceSymbolUsage on the affected symbols.';

/** A once that claims each key a single time, recording the keys it claims, and throws for a key hook mode rejects. */
function claimingOnce(claimed = new Set()) {
  const keys = [];
  const once = (key) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) throw new TypeError(`hook.once rejects ${key}`);
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
  const result = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch)), once }, api);
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
  const files = Array.from({ length: 30 }, (_, i) => `src/${'p'.repeat(230)}${i}.ts`);
  const patch = files.map((file) => `*** Update File: ${file}`).join('\n');
  const claimed = new Set();
  const listedPaths = (result) =>
    result.context
      .split('\n')
      .filter((line) => line.startsWith('- `'))
      .map((line) => line.slice(3, line.indexOf('`', 3)));

  const first = claimingOnce(claimed);
  const firstResult = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch)), once: first.once }, api);
  assert.ok(firstResult.context.length <= 6000);
  assert.ok(firstResult.context.endsWith('\n' + IMPACT_FOOTER));
  assert.ok(first.keys.length > 0 && first.keys.length < files.length);
  assert.deepStrictEqual(listedPaths(firstResult), first.keys.map(pathOfKey));
  assert.ok(firstResult.message.endsWith(' (+' + (first.keys.length - 1) + ' more)'));

  const second = claimingOnce(claimed);
  const secondResult = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch)), once: second.once }, api);
  assert.ok(secondResult.context.endsWith('\n' + IMPACT_FOOTER));
  assert.deepStrictEqual(listedPaths(secondResult), second.keys.map(pathOfKey));
  assert.deepStrictEqual([...listedPaths(firstResult), ...listedPaths(secondResult)].sort(), [...files].sort());
});

test('impact returns null for low and medium risk files', async () => {
  for (const count of [0, 4, 5, 19]) {
    const { api } = dependentsApi(() => dependentsList(count));
    const patch = '*** Update File: src/a.ts\n';
    assert.strictEqual(await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api), null);
  }
});

test('impact skips a file whose once key was already taken', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(30));
  const keys = [];
  const hook = { ...hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json')), once: (key) => (keys.push(key), key !== 'impact:src/legacy.ts') };
  await run(IMPACT, hook, api);
  assert.deepStrictEqual(keys, ['impact:src/user.service.ts', 'impact:src/legacy.ts', 'impact:src/old-name.ts', 'impact:src/new-name.ts']);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    ['src/user.service.ts', 'src/old-name.ts', 'src/new-name.ts'],
  );
});

test('impact returns null when every file was already reported', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(30));
  const hook = { ...hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json')), once: () => false };
  assert.strictEqual(await run(IMPACT, hook, api), null);
  assert.strictEqual(calls.length, 0);
});

/** The error the sandbox throws for a failed api call, wrapping Core's `message`. */
function sandboxError(params, message) {
  return new Error(
    'API call failed: api.getDependents()\n' +
      `  Parameters: ${JSON.stringify(params)}\n` +
      '  Duration: 12ms\n' +
      `  Error: ${message}`,
  );
}

test('impact counts a file that is not in the graph as zero dependents', async () => {
  const { api } = dependentsApi((params) => {
    if (params.filePath === 'src/user.service.ts') throw sandboxError(params, `File not found: ${params.filePath}`);
    return dependentsList(30);
  });
  const result = await run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json')), api);
  assert.doesNotMatch(result.context, /user\.service\.ts/);
  assert.match(result.context, /src\/legacy\.ts/);
});

/** The error MCP's filePath guard throws for an extension the project does not index. */
function unsupportedLanguage(filePath) {
  const extension = filePath.slice(filePath.lastIndexOf('.'));
  const error = new Error(
    `Unsupported file extension '${extension}' for filePath '${filePath}'. This project is configured to index: .js, .ts.`,
  );
  error.name = 'UnsupportedLanguageError';
  return error;
}

test('impact skips a file whose lookup fails and still lists the others in a mixed patch', async () => {
  const { api, calls } = dependentsApi((params) => {
    if (!/\.ts$/.test(params.filePath)) throw unsupportedLanguage(params.filePath);
    if (params.filePath === 'src/slow.ts') throw sandboxError(params, 'Request timed out');
    return dependentsList(30);
  });
  const patch = ['README.md', 'src/a.ts', 'package.json', 'src/slow.ts', '.github/workflows/ci.yml', 'scripts/x.mjs', 'src/b.ts']
    .map((file) => `*** Update File: ${file}`)
    .join('\n');
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.strictEqual(calls.length, 7);
  const listed = result.context.split('\n').filter((line) => line.startsWith('- '));
  assert.deepStrictEqual(
    listed.map((line) => line.slice(3, line.indexOf('`', 3))),
    ['src/a.ts', 'src/b.ts'],
  );
  assert.strictEqual(result.message, 'src/a.ts: high risk, 30 dependents (+1 more)');
});

test('impact fetches dependents concurrently and lists files in patch order', async () => {
  let inFlight = 0;
  let peak = 0;
  const { api } = dependentsApi(async (params) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    // Later files answer first.
    await new Promise((resolve) => setTimeout(resolve, 40 - Number(/\d+/.exec(params.filePath)[0]) * 10));
    inFlight--;
    return dependentsList(30);
  });
  const patch = ['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts'].map((file) => `*** Update File: ${file}`).join('\n');
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.strictEqual(peak, 4);
  const listed = result.context.split('\n').filter((line) => line.startsWith('- '));
  assert.deepStrictEqual(
    listed.map((line) => line.slice(3, line.indexOf('`', 3))),
    ['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts'],
  );
  assert.strictEqual(result.message, 'src/f0.ts: high risk, 30 dependents (+3 more)');
});

test('impact skips a path whose once key hook mode would reject', async () => {
  const { api, calls } = dependentsApi(() => dependentsList(30));
  const atLimit = `src/${'a'.repeat(256 - 'impact:src/'.length - '.ts'.length)}.ts`;
  const overLimit = `src/${'b'.repeat(256 - 'impact:src/'.length - '.ts'.length + 1)}.ts`;
  assert.strictEqual(('impact:' + atLimit).length, 256);
  const patch = [overLimit, atLimit, 'src/a.ts'].map((file) => `*** Update File: ${file}`).join('\n');
  const { once, keys } = claimingOnce();
  const result = await run(IMPACT, { ...hookFor(IMPACT, patchEvent(patch)), once }, api);
  assert.deepStrictEqual(keys, ['impact:' + atLimit, 'impact:src/a.ts']);
  assert.deepStrictEqual(
    calls.map((params) => params.filePath),
    [atLimit, 'src/a.ts'],
  );
  assert.doesNotMatch(result.context, /bbb/);
  assert.strictEqual(result.message, `${atLimit}: high risk, 30 dependents (+1 more)`);
});

test('impact returns null when every lookup fails', async () => {
  const { api, calls } = dependentsApi(() => {
    throw new Error('unavailable');
  });
  assert.strictEqual(await run(IMPACT, hookFor(IMPACT, fixture('pre-tool-use-apply-patch.json')), api), null);
  assert.strictEqual(calls.length, 4);
});

test('impact output holds only context and message and no source text', async () => {
  const { api } = dependentsApi(() => dependentsList(30));
  const patch = '*** Update File: src/a.ts\n@@\n-const secret = 1;\n+const secret = 2;\n';
  const result = await run(IMPACT, hookFor(IMPACT, patchEvent(patch)), api);
  assert.deepStrictEqual(Object.keys(result).sort(), ['context', 'message']);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

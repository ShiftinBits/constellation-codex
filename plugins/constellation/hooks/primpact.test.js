'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'primpact.js');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-tool-use-gh-pr-create.json'), 'utf8'));

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** An indexed git repo on a feature branch that changes two files against main. */
function repo(files = ['src/a.js', 'src/b.js']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-primpact-'));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  git(root, 'add', 'constellation.json');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'feature');
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'x');
    git(root, 'add', file);
  }
  git(root, 'commit', '-q', '-m', 'change');
  return root;
}

function call(root, command, { mode = 'inform', key = 'ak:test', data, session = 'sess-1' } = {}) {
  const env = { ...process.env };
  delete env.CONSTELLATION_ACCESS_KEY;
  delete env.CONSTELLATION_PR_IMPACT;
  if (key) env.CONSTELLATION_ACCESS_KEY = key;
  if (mode) env.CONSTELLATION_PR_IMPACT = mode;
  env.PLUGIN_DATA = data;
  const input = { ...fixture(), session_id: session, cwd: root, tool_input: { command } };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  if (result.stdout !== '') {
    const output = JSON.parse(result.stdout);
    for (const key of Object.keys(output)) assert.ok(['hookSpecificOutput', 'systemMessage'].includes(key), key);
    assert.deepStrictEqual(Object.keys(output.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  }
  return result.stdout;
}

const data = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codex-data-'));

test('inform mode gives a ready-to-paste Impact section listing the changed files', () => {
  const out = JSON.parse(call(repo(), 'gh pr create --title T', { data: data() }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /^## Impact$/m);
  assert.match(text, /- `src\/a\.js`/);
  assert.match(text, /- `src\/b\.js`/);
  assert.match(text, /api\.getDependents/);
  assert.match(text, /gh pr edit/);
});

test('the file list is capped at 50 with a count of the rest', () => {
  const files = Array.from({ length: 53 }, (_, i) => `f${i}.js`);
  const text = JSON.parse(call(repo(files), 'gh pr create', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /- \+3 more/);
  assert.strictEqual(text.match(/^- `/gm).length, 50);
});

test('the fixture command, sent as Codex sends it, gets the section', () => {
  const root = repo();
  const env = { ...process.env, CONSTELLATION_ACCESS_KEY: 'ak:test', CONSTELLATION_PR_IMPACT: 'inform', PLUGIN_DATA: data() };
  const input = { ...fixture(), cwd: root };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /^## Impact$/m);
  assert.match(text, /- `src\/a\.js`/);
});

/**
 * A clone of a bare origin whose default branch is trunk, on a feature branch
 * cut from origin/trunk after upstream.js landed there. The local trunk is
 * left behind at the first commit, so diffing against it would list upstream.js.
 */
function cloneOfOrigin() {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-origin-'));
  git(origin, 'init', '-q', '--bare', '-b', 'trunk');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-primpact-'));
  git(root, 'init', '-q', '-b', 'trunk');
  git(root, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  git(root, 'add', 'constellation.json');
  git(root, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(root, 'upstream.js'), 'x');
  git(root, 'add', 'upstream.js');
  git(root, 'commit', '-q', '-m', 'upstream');
  git(root, 'push', '-q', 'origin', 'trunk');
  git(root, 'remote', 'set-head', 'origin', 'trunk');
  git(root, 'checkout', '-q', '-b', 'feature', 'origin/trunk');
  git(root, 'branch', '-q', '-f', 'trunk', 'trunk~1');
  fs.writeFileSync(path.join(root, 'a.js'), 'x');
  git(root, 'add', 'a.js');
  git(root, 'commit', '-q', '-m', 'change');
  return root;
}

test("without --base the diff runs against origin's default branch as origin has it", () => {
  const root = cloneOfOrigin();
  const text = JSON.parse(call(root, 'gh pr create', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /- `a\.js`/);
  assert.doesNotMatch(text, /upstream\.js/);
});

test('--base uses the remote-tracking ref when origin has the branch', () => {
  const root = cloneOfOrigin();
  const text = JSON.parse(call(root, 'gh pr create --base trunk', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /- `a\.js`/);
  assert.doesNotMatch(text, /upstream\.js/);
});

test('the hook makes at most two git calls', () => {
  const root = cloneOfOrigin();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bin-'));
  const log = path.join(bin, 'calls');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho x >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CONSTELLATION_ACCESS_KEY: 'ak:test', CONSTELLATION_PR_IMPACT: 'inform', PLUGIN_DATA: data() };
  const input = { ...fixture(), cwd: root, tool_input: { command: 'gh pr create' } };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8' });
  assert.match(result.stdout, /a\.js/);
  assert.strictEqual(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 2);
});

test('a renamed file lists both its old and new path', () => {
  const root = repo(['old.js']);
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--ff-only', 'feature');
  git(root, 'checkout', '-q', '-b', 'rename');
  git(root, 'mv', 'old.js', 'new.js');
  git(root, 'commit', '-q', '-m', 'rename');
  const text = JSON.parse(call(root, 'gh pr create', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /^- `old\.js`$/m);
  assert.match(text, /^- `new\.js`$/m);
});

test('a non-ASCII path is listed as written, not C-quoted', () => {
  const text = JSON.parse(call(repo(['src/文件.js', 'src/a b.js']), 'gh pr create', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /^- `src\/文件\.js`$/m);
  assert.match(text, /^- `src\/a b\.js`$/m);
  assert.doesNotMatch(text, /\\\d{3}/);
});

test('a chained gh pr create after git push gets the section', () => {
  const out = call(repo(), 'git push -u origin HEAD && gh pr create --fill', { data: data() });
  assert.match(out, /src\/a\.js/);
});

test('--base picks the comparison branch', () => {
  const root = repo();
  git(root, 'branch', 'develop', 'HEAD~1');
  const text = JSON.parse(call(root, 'gh pr create --base develop', { data: data() })).hookSpecificOutput.additionalContext;
  assert.match(text, /src\/a\.js/);
});

test('cd <dir> && resolves the repository from the directory', () => {
  const root = repo();
  const out = call(path.dirname(root), `cd ${root} && gh pr create`, { data: data() });
  assert.match(out, /src\/a\.js/);
});

test('mode off, a missing key and a non-inform mode are no-ops', () => {
  const root = repo();
  assert.strictEqual(call(root, 'gh pr create', { mode: '', data: data() }), '');
  assert.strictEqual(call(root, 'gh pr create', { mode: 'off', data: data() }), '');
  assert.strictEqual(call(root, 'gh pr create', { key: '', data: data() }), '');
});

test('a non-gh command does no git work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-primpact-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bin-'));
  const marker = path.join(bin, 'called');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CONSTELLATION_ACCESS_KEY: 'ak:test', CONSTELLATION_PR_IMPACT: 'inform', PLUGIN_DATA: data() };
  const send = (command) => {
    const input = { ...fixture(), cwd: root, tool_input: { command } };
    const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8' });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
  };
  for (const command of ['git status', 'ls', 'gh pr list']) send(command);
  assert.strictEqual(fs.existsSync(marker), false);
  // The same setup reaches git for gh pr create, so the stub would have seen a call.
  send('gh pr create');
  assert.strictEqual(fs.existsSync(marker), true);
});

test('an Impact heading in --body or --body-file gives nothing', () => {
  const root = repo();
  const file = path.join(root, 'body.md');
  fs.writeFileSync(file, 'Summary\n\n### Impact\n\nStuff\n');
  assert.strictEqual(call(root, 'gh pr create --body "Summary\n\n## Impact\n\nNone"', { data: data() }), '');
  assert.strictEqual(call(root, `gh pr create --body-file ${file}`, { data: data() }), '');
  assert.strictEqual(call(root, 'gh pr create -F body.md', { data: data() }), '');
});

test('a body without an Impact heading still gets the section', () => {
  const root = repo();
  assert.match(call(root, 'gh pr create --body "Mentions Impact in prose"', { data: data() }), /## Impact/);
  assert.match(call(root, 'gh pr create --body "#### Impact"', { data: data() }), /## Impact/);
});

test('a body that cannot be read counts as having no Impact section', () => {
  const root = repo();
  assert.match(call(root, 'gh pr create --body-file missing.md', { data: data() }), /## Impact/);
  assert.match(call(root, 'gh pr create --body-file -', { data: data() }), /## Impact/);
});

test('the second call on the same branch gives nothing', () => {
  const root = repo();
  const dir = data();
  assert.match(call(root, 'gh pr create', { data: dir }), /## Impact/);
  assert.strictEqual(call(root, 'gh pr create', { data: dir }), '');
});

test('another project on the same branch name in the session still gets its section', () => {
  const dir = data();
  assert.match(call(repo(), 'gh pr create', { data: dir }), /## Impact/);
  assert.match(call(repo(), 'gh pr create', { data: dir }), /## Impact/);
});

test('a detached HEAD gives nothing', () => {
  const root = repo();
  git(root, 'checkout', '-q', '--detach');
  assert.strictEqual(call(root, 'gh pr create', { data: data() }), '');
});

test('a git failure gives nothing', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-primpact-'));
  fs.writeFileSync(path.join(plain, 'constellation.json'), '{}');
  assert.strictEqual(call(plain, 'gh pr create', { data: data() }), '');
  assert.strictEqual(call(repo(), 'gh pr create --base nope', { data: data() }), '');
  assert.strictEqual(call(repo(), 'gh pr create --base=--output=x', { data: data() }), '');
});

test('a branch with no changes gives nothing', () => {
  const root = repo();
  git(root, 'checkout', '-q', 'main');
  assert.strictEqual(call(root, 'gh pr create', { data: data() }), '');
});

test('an unindexed directory gives nothing', () => {
  const root = repo();
  fs.unlinkSync(path.join(root, 'constellation.json'));
  assert.strictEqual(call(root, 'gh pr create', { data: data() }), '');
});

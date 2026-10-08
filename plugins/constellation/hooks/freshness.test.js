'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { COMMIT, GIT_MOVES, envelopeOf, freshnessNotice, localState } = require('./freshness');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

function gitIn(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
}

/** A temp project with two commits; returns the root and both commit ids. */
function repoWithTwoCommits() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fresh-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', 'constellation.json');
  gitIn(root, 'commit', '-q', '-m', 'first');
  const first = gitIn(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  gitIn(root, 'add', 'a.txt');
  gitIn(root, 'commit', '-q', '-m', 'second');
  return { root, first, second: gitIn(root, 'rev-parse', 'HEAD') };
}

test('envelopeOf reads structuredContent', () => {
  assert.deepStrictEqual(envelopeOf(fixture('post-tool-use-code-intel.json').tool_response), {
    success: true,
    asOfCommit: '0123456789abcdef0123456789abcdef01234567',
    lastIndexedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('envelopeOf falls back to the first text block', () => {
  const response = { content: [{ type: 'text', text: '{"success":true,"asOfCommit":"abc1234","lastIndexedAt":"2026-02-02T00:00:00Z"}' }] };
  assert.deepStrictEqual(envelopeOf(response), { success: true, asOfCommit: 'abc1234', lastIndexedAt: '2026-02-02T00:00:00Z' });
});

test('envelopeOf strips an Error: prefix from the text block', () => {
  const response = { content: [{ type: 'text', text: 'Error: {"success":false,"error":{"code":"X"}}' }], isError: true };
  assert.deepStrictEqual(envelopeOf(response), { success: false });
});

test('envelopeOf is null for anything that is not an envelope', () => {
  for (const value of [undefined, null, 5, '', 'not json', {}, { content: [] }, { content: [{ type: 'text', text: 'plain' }] }, { structuredContent: { ok: 1 } }]) {
    assert.strictEqual(envelopeOf(value), null);
  }
});

test('COMMIT accepts hex ids of 7 to 64 characters only', () => {
  assert.ok(COMMIT.test('abc1234'));
  assert.ok(COMMIT.test('A'.repeat(64)));
  for (const bad of ['abc123', 'a'.repeat(65), 'main', '--upload-pack=x', 'abc1234;ls', '']) assert.ok(!COMMIT.test(bad), bad);
});

test('GIT_MOVES matches HEAD-moving git commands only', () => {
  for (const verb of ['commit', 'pull', 'checkout', 'merge', 'rebase']) assert.ok(GIT_MOVES.test(`git ${verb} x`), verb);
  assert.ok(GIT_MOVES.test('cd x && git -C sub commit -m y'));
  for (const command of ['git status', 'git log --oneline', 'echo git; commit', 'ls', 'npm run commit']) assert.ok(!GIT_MOVES.test(command), command);
});

test('localState reports HEAD and how many commits it is past the indexed commit', () => {
  const { root, first, second } = repoWithTwoCommits();
  assert.deepStrictEqual(localState(root, first), { head: second, behind: 1 });
  assert.deepStrictEqual(localState(root, second.slice(0, 10)), { head: second, behind: 0 });
});

test('localState leaves the count unknown for a commit git does not have', () => {
  const { root, second } = repoWithTwoCommits();
  assert.deepStrictEqual(localState(root, 'deadbeefdead'), { head: second, behind: null });
});

test('localState is null outside a repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-nogit-'));
  assert.strictEqual(localState(dir, 'abc1234'), null);
});

function stubbed(head, behind) {
  const calls = [];
  const probe = (root, asOf) => {
    calls.push([root, asOf]);
    return { head, behind };
  };
  return { probe, calls };
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fresh-stub-'));
  fs.writeFileSync(path.join(root, 'constellation.json'), '{}');
  return root;
}

test('freshnessNotice names the indexed commit and the distance', () => {
  const root = project();
  const { probe } = stubbed('f'.repeat(40), 3);
  const notice = freshnessNotice('git pull', root, { index: { [root]: { asOfCommit: 'abcdef0123456' } } }, probe);
  assert.match(notice.context, /`abcdef0`/);
  assert.match(notice.context, /\(3 commits behind\)/);
  assert.match(notice.context, /recently changed files/);
});

test('freshnessNotice omits the distance when it is unknown', () => {
  const root = project();
  const { probe } = stubbed('f'.repeat(40), null);
  const notice = freshnessNotice('git checkout x', root, { index: { [root]: { asOfCommit: 'abcdef0' } } }, probe);
  assert.doesNotMatch(notice.context, /behind/);
});

test('freshnessNotice does not spawn for a non-git command, a missing index, or an invalid commit', () => {
  const root = project();
  const { probe, calls } = stubbed('f'.repeat(40), 1);
  assert.strictEqual(freshnessNotice('ls', root, { index: { [root]: { asOfCommit: 'abcdef0' } } }, probe), null);
  assert.strictEqual(freshnessNotice('git commit', root, {}, probe), null);
  assert.strictEqual(freshnessNotice('git commit', root, { index: { [root]: {} } }, probe), null);
  assert.strictEqual(freshnessNotice('git commit', root, { index: { [root]: { asOfCommit: '--upload-pack=x' } } }, probe), null);
  assert.strictEqual(freshnessNotice('git commit', os.tmpdir(), { index: {} }, probe), null);
  assert.deepStrictEqual(calls, []);
});

test('freshnessNotice is quiet when HEAD is the indexed commit or git fails', () => {
  const root = project();
  const state = { index: { [root]: { asOfCommit: 'abcdef0' } } };
  assert.strictEqual(freshnessNotice('git pull', root, state, () => ({ head: 'abcdef0123', behind: 0 })), null);
  assert.strictEqual(freshnessNotice('git pull', root, state, () => null), null);
});

test('freshnessNotice warns once per HEAD and suggests reindexing once per session', () => {
  const root = project();
  const state = { index: { [root]: { asOfCommit: 'abcdef0' } } };
  const first = freshnessNotice('git pull', root, state, stubbed('1'.repeat(40), 1).probe);
  assert.ok(first.systemMessage.includes('constellation index'));
  assert.strictEqual(first.state.reindexSuggested, true);

  assert.strictEqual(freshnessNotice('git pull', root, first.state, stubbed('1'.repeat(40), 1).probe), null);

  const second = freshnessNotice('git pull', root, first.state, stubbed('2'.repeat(40), 2).probe);
  assert.ok(second.context);
  assert.strictEqual(second.systemMessage, undefined);
  assert.strictEqual(second.state.freshness[root].warnedHead, '2'.repeat(40));
});

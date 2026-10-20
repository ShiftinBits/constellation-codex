'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

const { bashSearch, ghPrCreate, isSymbolLike, symbolOf } = require('./classify');

describe('symbolOf', () => {
  const rows = [
    ['AuthService', 'AuthService'],
    ['get_user', 'get_user'],
    ['$scope', '$scope'],
    ['_private', '_private'],
    ['  AuthService  ', 'AuthService'],
    ['class UserService', 'UserService'],
    ['interface UserShape', 'UserShape'],
    ['function parseInput', 'parseInput'],
    ['def get_user', 'get_user'],
    ['func ServeHTTP', 'ServeHTTP'],
    ['type Options', 'Options'],
    ['getUser\\(', 'getUser'],
    ['getUser\\(\\)', 'getUser'],
    ['\\bAuthService\\b', 'AuthService'],
    ['\\bAuthService', 'AuthService'],
    ['AuthService\\b', 'AuthService'],
    ['\\bgetUser\\(', 'getUser'],
    ['connection refused', null],
    ['"connection refused"', null],
    ['class', null],
    ['import', null],
    ['export', null],
    ['Package', 'Package'],
    ['Type', 'Type'],
    ['Default', 'Default'],
    ['class User Service', null],
    ['TODO', null],
    ['FIXME', null],
    ['ERROR', null],
    ['MAX_RETRIES', null],
    ['[A-Z]+', null],
    ['Foo|Bar', null],
    ['Foo.*', null],
    ['Foo+', null],
    ['Foo?', null],
    ['a.b.c', null],
    ['a/b', null],
    ['src/app.ts', null],
    ['123abc', null],
    ['getUser(', null],
    ['', null],
  ];
  for (const [pattern, expected] of rows) {
    test(`${JSON.stringify(pattern)} gives ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(symbolOf(pattern), expected);
      assert.strictEqual(isSymbolLike(pattern), expected !== null);
    });
  }
});

describe('bashSearch pattern', () => {
  const rows = [
    ['grep Foo .', 'Foo'],
    ['grep -rn Foo src/', 'Foo'],
    ['grep -e Foo .', 'Foo'],
    ['grep -rn --regexp Foo .', 'Foo'],
    ['grep --regexp=Foo .', 'Foo'],
    ['grep -A 3 -e Foo .', 'Foo'],
    ['egrep Foo .', 'Foo'],
    ['rg AuthService src/', 'AuthService'],
    ['ag Foo', 'Foo'],
    ['ack Foo', 'Foo'],
    ['git grep Foo', 'Foo'],
    ['git grep -n Foo -- src', 'Foo'],
    ['grep "connection refused" .', 'connection refused'],
    ["grep -rn 'connection refused' src", 'connection refused'],
    ["rg '\\bFoo\\b' src", '\\bFoo\\b'],
    ['rg "class UserService"', 'class UserService'],
    ["rg 'a|b' src", 'a|b'],
    ['grep Foo . | head', 'Foo'],
    ['grep Foo . ; ls', 'Foo'],
    ['grep Foo . && ls', 'Foo'],
    ['grep Foo . || true', 'Foo'],
    ['cat log.txt | grep ERROR', null],
    ['git log | grep x', null],
    ['ls && grep Foo .', null],
    ['echo hi; rg Foo', null],
    ['git log Foo', null],
    ['awk /Foo/ file', null],
    ['findstr Foo file', null],
    ['ls -la', null],
    ['', null],
    ['grep', null],
    ['grep -rn', null],
    ['grep -e', null],
    ["grep 'unterminated Foo", 'unterminated Foo'],
    ['grep -r AuthService .', 'AuthService'],
    ['grep -eAuthService .', 'AuthService'],
    ['rg -t ts AuthService src', 'AuthService'],
    ['rg --type ts AuthService', 'AuthService'],
    ['rg --type=ts AuthService', 'AuthService'],
    ['grep -A 3 AuthService src', 'AuthService'],
    ['rg -C 2 AuthService', 'AuthService'],
    ["rg -g '*.ts' AuthService", 'AuthService'],
    ["grep --include '*.ts' -rn AuthService .", 'AuthService'],
    ['rg -m 1 AuthService', 'AuthService'],
    ['rg -- -dashed src', '-dashed'],
    ['rg -t ts', null],
    ['cd /repo/core && grep -rn GraphQueryService libs', 'GraphQueryService'],
    ['cd /repo/core; rg Foo', 'Foo'],
    ['cd /repo/core || rg Foo', null],
    ['git -C /repo/core grep Foo', 'Foo'],
    ['LC_ALL=C grep -rn Foo .', 'Foo'],
    ['FOO=1 BAR=2 rg Foo', 'Foo'],
    ['rg -r X AuthService src', 'AuthService'],
    ['rg -T js AuthService', 'AuthService'],
    ['rg -E latin1 AuthService', 'AuthService'],
    ['rg --encoding latin1 AuthService', 'AuthService'],
    ['grep -E Auth src', 'Auth'],
    ['grep -T AuthService src', 'AuthService'],
    ['grep "say \\"hi\\" | x" src', 'say "hi" | x'],
    ['grep "a\\\\" src', 'a\\'],
    ["grep 'a\\' src", 'a\\'],
    ['rg Auth\\Service', 'AuthService'],
    ['rg \\"AuthService\\"', '"AuthService"'],
    ['rg \\\n  AuthService src', 'AuthService'],
  ];
  for (const [command, expected] of rows) {
    test(`${JSON.stringify(command)} gives ${JSON.stringify(expected)}`, () => {
      const search = bashSearch(command);
      assert.strictEqual(search === null ? null : search.pattern, expected);
    });
  }

  test('rg "UserService" gives UserService', () => {
    assert.strictEqual(symbolOf(bashSearch('rg "UserService"').pattern), 'UserService');
  });

  test('rg "connection refused" gives no symbol', () => {
    assert.strictEqual(symbolOf(bashSearch('rg "connection refused"').pattern), null);
  });

  test('grep -r TODO gives no symbol', () => {
    assert.strictEqual(symbolOf(bashSearch('grep -r TODO').pattern), null);
  });
});

describe('bashSearch path', () => {
  const rows = [
    ['rg Foo', undefined],
    ['rg Foo src', 'src'],
    ['rg -n SearchSymbolsParams ../constellation-cli/src', '../constellation-cli/src'],
    ['grep -rn AuthService /abs/core/src', '/abs/core/src'],
    ['rg -e Foo lib test', 'lib'],
    ['rg -t ts Foo -- src', 'src'],
    ['cd /repo/core && grep -rn Foo libs', '/repo/core/libs'],
    ['cd /repo/core && rg Foo', '/repo/core'],
    ['cd sub && rg Foo /abs/x', '/abs/x'],
    ['git -C /repo/core grep Foo', '/repo/core'],
    ['git -C core grep Foo lib', 'core/lib'],
  ];
  for (const [command, expected] of rows) {
    test(`${JSON.stringify(command)} searches ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(bashSearch(command).path, expected);
    });
  }
});

describe('ghPrCreate', () => {
  const rows = [
    ['gh pr create', {}],
    ['gh pr create --base develop', { base: 'develop' }],
    ['gh pr create --base=develop', { base: 'develop' }],
    ['gh pr create -B develop', { base: 'develop' }],
    ['gh pr create --body "Some text"', { body: 'Some text' }],
    ['gh pr create --body="Some text"', { body: 'Some text' }],
    ['gh pr create -b "Some text"', { body: 'Some text' }],
    ['gh pr create --body-file notes.md', { bodyFile: 'notes.md' }],
    ['gh pr create --body-file=notes.md', { bodyFile: 'notes.md' }],
    ['gh pr create -F notes.md', { bodyFile: 'notes.md' }],
    ['GH_TOKEN=x gh pr create --title "T" -B main', { base: 'main' }],
    ['cd packages/app && gh pr create -B main', { dir: 'packages/app', base: 'main' }],
    ['cd packages/app ; gh pr create', { dir: 'packages/app' }],
    ['cd packages && cd app && gh pr create', { dir: 'packages/app' }],
    ['cd packages && cd /abs/app && gh pr create', { dir: '/abs/app' }],
    ['gh pr new --base develop', { base: 'develop' }],
    ['echo hi && gh pr create', {}],
    ['git push -u origin HEAD && gh pr create --fill --base main', { base: 'main' }],
    ['git add -A; git commit -m "x" && gh pr create -B main', { base: 'main' }],
    ['cd packages/app && git push && gh pr create', { dir: 'packages/app' }],
    ['git log | head -1 && gh pr create', {}],
    ['gh pr create --body "--web"', { body: '--web' }],
    ['gh pr create --body "Fixes \\"x\\" | y\n\n## Impact\n- a" -B main', { body: 'Fixes "x" | y\n\n## Impact\n- a', base: 'main' }],
    ['gh pr create \\\n  --base develop \\\n  --fill', { base: 'develop' }],
  ];
  for (const [line, expected] of rows) {
    test(`reads ${line}`, () => {
      assert.deepStrictEqual(ghPrCreate(line), {
        dir: undefined,
        base: undefined,
        body: undefined,
        bodyFile: undefined,
        ...expected,
      });
    });
  }

  const rejected = [
    'gh pr create --fill | cat',
    'gh pr list',
    'gh pr view 1',
    'git commit -m "gh pr create"',
    'cd ~/app && gh pr create',
    'cd $HOME && gh pr create',
    'cd -P x && gh pr create',
    'cd a$b && gh pr create',
    'cd `pwd` && gh pr create',
    'cd && gh pr create',
    'git push && cd ~/app && gh pr create',
    'git push && gh pr create --fill | cat',
    'echo hi | gh pr create',
    'git push && gh pr list',
    'gh pr create --help',
    'gh pr create -h',
    'gh pr create --dry-run',
    'gh pr create --web',
    'gh pr new -w',
    'git push && gh pr create --title T --dry-run',
    'ls',
  ];
  for (const line of rejected) {
    test(`null for ${line}`, () => {
      assert.strictEqual(ghPrCreate(line), null);
    });
  }
});

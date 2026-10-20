'use strict';

const fs = require('fs');
const { ghPrCreate } = require('./classify');
const { git } = require('./freshness');
const { absolute, projectRoot } = require('./lib');

const MAX_FILES = 50;
const BODY_FILE_CAP = 64 * 1024;
const IMPACT_HEADING = /^ {0,3}#{1,3}[ \t]+Impact[ \t]*#*[ \t]*$/im;
const ORIGIN = 'refs/remotes/origin/';

/** Up to BODY_FILE_CAP bytes of `file`, or '' when it cannot be read. */
function readCapped(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(BODY_FILE_CAP);
    return buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, BODY_FILE_CAP, 0));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** True when the PR body, given inline or as a file, already has an Impact heading (level 1 to 3). */
function hasImpactSection(pr, dir) {
  const text = pr.body !== undefined ? pr.body : pr.bodyFile !== undefined ? readCapped(absolute(pr.bodyFile, dir)) : '';
  return IMPACT_HEADING.test(text);
}

/**
 * The current branch and the ref to compare it against, from two git calls
 * that name only the refs they need. The base is the explicit one, else
 * origin's default branch, else main, taken as origin's remote-tracking ref
 * when there is one, since the local branch can be stale or missing, and else
 * as the local branch. Null on a detached HEAD.
 */
function refsOf(pr, dir) {
  const head = git(dir, ['rev-parse', '--symbolic-full-name', 'HEAD']);
  if (!head.startsWith('refs/heads/')) return null;
  const branch = head.slice('refs/heads/'.length);
  const wanted = ORIGIN + (pr.base || 'main');
  const refs = git(dir, ['for-each-ref', '--format=%(refname)%09%(symref)', ORIGIN + 'HEAD', wanted]);
  let originHead = null;
  let hasWanted = false;
  for (const line of refs.split('\n')) {
    const [ref, symref] = line.split('\t');
    if (ref === ORIGIN + 'HEAD') originHead = symref;
    else if (ref === wanted) hasWanted = true;
  }
  if (!pr.base && originHead && originHead.startsWith(ORIGIN)) return { branch, base: originHead };
  return { branch, base: hasWanted ? wanted : pr.base || 'main' };
}

function sectionText(files) {
  const shown = files.slice(0, MAX_FILES).map((file) => `- \`${file}\``);
  if (files.length > MAX_FILES) shown.push(`- +${files.length - MAX_FILES} more`);
  return [
    'This PR has no Impact section. Add the section below to the PR body, for example with `gh pr edit`.',
    'Fill in the dependents of each changed file with code_intel api.getDependents.',
    '',
    '## Impact',
    '',
    'Changed files:',
    ...shown,
  ].join('\n');
}

/**
 * The Impact section to suggest after `command` and the session state it
 * leaves, or null when none applies. Off unless CONSTELLATION_PR_IMPACT is
 * `inform`; only a `gh pr create` in an indexed git project whose body has no
 * Impact heading gets one, once per project and branch. The changed files are
 * those under the project root, relative to it, as the graph holds them.
 */
function prImpactFor(command, input, state) {
  if (process.env.CONSTELLATION_PR_IMPACT !== 'inform') return null;
  const pr = ghPrCreate(command);
  if (pr === null) return null;

  const dir = pr.dir === undefined ? input.cwd : absolute(pr.dir, input.cwd);
  const root = projectRoot(dir);
  if (root === null) return null;
  if (hasImpactSection(pr, dir)) return null;

  let refs;
  let files;
  try {
    refs = refsOf(pr, root);
    if (refs === null || refs.base.startsWith('-')) return null;
    // Without renames a moved file lists both paths, -z keeps paths unquoted,
    // and --relative keeps only the project's files, relative to its root.
    files = git(root, ['diff', '--name-only', '--no-renames', '-z', '--relative', `${refs.base}...HEAD`, '--'])
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  // Once per project and branch, so another indexed repository on the same
  // branch name in this session still gets its section.
  const key = JSON.stringify([root, refs.branch]);
  const sent = state.prImpact || {};
  if (sent[key]) return null;
  return { text: sectionText(files), state: { ...state, prImpact: { ...sent, [key]: true } } };
}

module.exports = { prImpactFor };

'use strict';

const fs = require('fs');
const { ghPrCreate } = require('./classify');
const { git } = require('./freshness');
const { absolute, contextOutput, emit, isConfigured, loadState, projectRoot, readInput, saveState } = require('./lib');

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
 * The current branch and the ref to compare it against, from one git call. The
 * base is the explicit one, else origin's default branch, else main, taken as
 * origin's remote-tracking ref when there is one, since the local branch can
 * be stale or missing, and else as the local branch. Null on a detached HEAD.
 */
function refsOf(pr, dir) {
  const refs = git(dir, ['for-each-ref', '--format=%(refname)%09%(symref)%09%(HEAD)', 'refs/heads/', ORIGIN]);
  let branch = null;
  let originHead = null;
  const remote = new Set();
  for (const line of refs.split('\n')) {
    const [ref, symref, head] = line.split('\t');
    if (head === '*' && ref.startsWith('refs/heads/')) branch = ref.slice('refs/heads/'.length);
    else if (ref === ORIGIN + 'HEAD') originHead = symref;
    else if (ref.startsWith(ORIGIN)) remote.add(ref.slice(ORIGIN.length));
  }
  if (branch === null) return null;
  const base = pr.base || (originHead && originHead.startsWith(ORIGIN) ? originHead.slice(ORIGIN.length) : 'main');
  return { branch, base: remote.has(base) ? ORIGIN + base : base };
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

async function run() {
  if (!isConfigured() || process.env.CONSTELLATION_PR_IMPACT !== 'inform') return;

  const input = await readInput();
  if (input.tool_name !== 'Bash') return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || typeof input.cwd !== 'string' || input.cwd === '') return;
  const pr = ghPrCreate(command);
  if (pr === null) return;

  const dir = pr.dir === undefined ? input.cwd : absolute(pr.dir, input.cwd);
  const root = projectRoot(dir);
  if (root === null) return;
  if (hasImpactSection(pr, dir)) return;

  let refs;
  let files;
  try {
    refs = refsOf(pr, dir);
    if (refs === null || refs.base.startsWith('-')) return;
    files = git(dir, ['diff', '--name-only', `${refs.base}...HEAD`, '--']).split('\n').filter(Boolean);
  } catch {
    return;
  }
  if (files.length === 0) return;

  // Once per project and branch, so another indexed repository on the same
  // branch name in this session still gets its section.
  const key = JSON.stringify([root, refs.branch]);
  const state = loadState(input.session_id);
  const sent = state.prImpact || {};
  if (sent[key]) return;
  saveState(input.session_id, { ...state, prImpact: { ...sent, [key]: true } }, state);

  emit(contextOutput('PreToolUse', sectionText(files)));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = { run };

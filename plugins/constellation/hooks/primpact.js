'use strict';

const fs = require('fs');
const { ghPrCreate } = require('./classify');
const { git } = require('./freshness');
const { absolute, contextOutput, emit, isConfigured, loadState, projectRoot, readInput, saveState } = require('./lib');

const MAX_FILES = 50;
const BODY_FILE_CAP = 64 * 1024;
const IMPACT_HEADING = /^ {0,3}#{1,3}[ \t]+Impact[ \t]*#*[ \t]*$/im;

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

/** The branch to compare against: the explicit base, else origin's default branch, else main. */
function baseOf(pr, dir) {
  if (pr.base) return pr.base;
  try {
    const head = git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).replace(/^origin\//, '');
    if (head !== '' && head !== 'origin/HEAD') return head;
  } catch {
    // Fall back to main.
  }
  return 'main';
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
  if (projectRoot(dir) === null) return;
  if (hasImpactSection(pr, dir)) return;

  let branch;
  let files;
  try {
    branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const base = baseOf(pr, dir);
    if (branch === '' || base.startsWith('-')) return;
    files = git(dir, ['diff', '--name-only', `${base}...HEAD`, '--']).split('\n').filter(Boolean);
  } catch {
    return;
  }
  if (files.length === 0) return;

  const state = loadState(input.session_id);
  const sent = state.prImpact || {};
  if (sent[branch]) return;
  saveState(input.session_id, { ...state, prImpact: { ...sent, [branch]: true } }, state);

  emit(contextOutput('PreToolUse', sectionText(files)));
}

if (require.main === module) {
  run().catch(() => {});
}

module.exports = { run };

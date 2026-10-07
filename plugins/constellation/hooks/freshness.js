'use strict';

const { execFileSync } = require('child_process');
const { projectRoot } = require('./lib');

/** A commit id as git prints it. Anything else from the server never reaches a git argument. */
const COMMIT = /^[0-9a-f]{7,64}$/i;

/**
 * A git command that moves HEAD or changes the tree: `git`, then options such
 * as `-C dir`, then the subcommand, with no `;`, `&`, `|` or line break
 * between them, so `cd x && git commit` counts and `echo git; commit` does not.
 */
const GIT_MOVES = /\bgit\s[^;&|\n]*\b(?:commit|pull|checkout|merge|rebase)\b/;

const GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never'];
// Two sequential calls must fit inside the 3 s Bash hook timeout, with time left for node startup.
const GIT_TIMEOUT_MS = 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fromBody(body) {
  if (!isRecord(body) || typeof body.success !== 'boolean') return null;
  const envelope = { success: body.success };
  if (typeof body.asOfCommit === 'string') envelope.asOfCommit = body.asOfCommit;
  if (typeof body.lastIndexedAt === 'string') envelope.lastIndexedAt = body.lastIndexedAt;
  return envelope;
}

function fromText(text) {
  if (typeof text !== 'string') return null;
  try {
    return fromBody(JSON.parse(text.replace(/^Error:\s*/, '')));
  } catch {
    return null;
  }
}

/**
 * The code_intel envelope fields the freshness check needs (success,
 * asOfCommit, lastIndexedAt) from a tool response, read from structuredContent
 * or else from the first text block. Null when neither holds an envelope.
 */
function envelopeOf(toolResponse) {
  if (typeof toolResponse === 'string') return fromText(toolResponse);
  if (!isRecord(toolResponse)) return null;
  const structured = fromBody(toolResponse.structuredContent);
  if (structured !== null) return structured;
  if (!Array.isArray(toolResponse.content)) return null;
  const block = toolResponse.content.find((item) => isRecord(item) && item.type === 'text');
  return block === undefined ? null : fromText(block.text);
}

function git(root, args) {
  return execFileSync('git', [...GIT, ...args], {
    cwd: root,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Where HEAD is against `asOfCommit` in the repository at `root`: the full HEAD
 * and how many commits HEAD is past `asOfCommit` (null when the count cannot
 * be taken). Null when git fails.
 */
function localState(root, asOfCommit) {
  try {
    const head = git(root, ['rev-parse', 'HEAD']);
    if (head === '') return null;
    if (head.startsWith(asOfCommit)) return { head, behind: 0 };
    let behind = null;
    try {
      const counted = git(root, ['rev-list', '--count', `${asOfCommit}..HEAD`, '--']);
      if (/^\d+$/.test(counted)) behind = Number(counted);
    } catch {
      // The count stays unknown.
    }
    return { head, behind };
  } catch {
    return null;
  }
}

function warningText(asOfCommit, behind) {
  const count = behind === null || behind === 0 ? '' : ` (${behind} commit${behind === 1 ? '' : 's'} behind)`;
  return `code_intel results reflect \`${asOfCommit.slice(0, 7)}\`${count}, which is not the current HEAD. Treat recently changed files with care.`;
}

const REINDEX_TEXT = 'The Constellation index is behind your checkout. Run `constellation index` to refresh it.';

/**
 * The freshness notice for a Bash command, or null. Spawns git only for a
 * HEAD-moving git command in a project with a known, valid indexed commit and
 * only warns once per HEAD. Returns the warning, the one-time reindex
 * suggestion, and the updated session state; the caller saves it.
 */
function freshnessNotice(command, cwd, state, probe = localState) {
  if (!GIT_MOVES.test(command)) return null;
  const root = projectRoot(cwd);
  if (root === null) return null;
  const known = state.index && state.index[root];
  const asOfCommit = known && known.asOfCommit;
  if (typeof asOfCommit !== 'string' || !COMMIT.test(asOfCommit)) return null;

  const local = probe(root, asOfCommit);
  if (local === null || local.head.startsWith(asOfCommit)) return null;
  const warned = state.freshness && state.freshness[root];
  if (warned && warned.warnedHead === local.head) return null;

  const next = {
    ...state,
    freshness: { ...(state.freshness || {}), [root]: { warnedHead: local.head } },
  };
  const notice = { context: warningText(asOfCommit, local.behind), state: next };
  if (!state.reindexSuggested) {
    notice.systemMessage = REINDEX_TEXT;
    next.reindexSuggested = true;
  }
  return notice;
}

module.exports = {
  COMMIT,
  GIT_MOVES,
  envelopeOf,
  freshnessNotice,
  localState,
};

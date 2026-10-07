'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_FILE = 'constellation.json';
const STDIN_DEADLINE_MS = 1000;
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readStdin(deadlineMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      process.stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(finish, deadlineMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

/** Parsed stdin JSON, or {} when stdin is empty, invalid, or does not close in time. */
async function readInput() {
  try {
    const text = await readStdin(STDIN_DEADLINE_MS);
    const parsed = JSON.parse(text || '{}');
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** True when the access key starts with `ak:`. */
function isConfigured(env = process.env) {
  return (env.CONSTELLATION_ACCESS_KEY || '').startsWith('ak:');
}

/** Resolves `target` against `cwd` into an absolute, forward-slash path with no `.` or `..` segments. */
function absolute(target, cwd) {
  const full = target.replace(/\\/g, '/');
  const joined = /^([A-Za-z]:)?\//.test(full) ? full : `${cwd.replace(/\\/g, '/')}/${full}`;
  const rootMatch = /^([A-Za-z]:)?\//.exec(joined);
  const root = rootMatch ? rootMatch[0] : '/';
  const segments = [];
  for (const segment of joined.slice(root.length).split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  return root + segments.join('/');
}

function findUp(start, name) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The nearest directory at or above `cwd` holding a constellation.json, or null. */
function projectRoot(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  return findUp(cwd, PROJECT_FILE);
}

function contextOutput(hookEventName, text) {
  return { hookSpecificOutput: { hookEventName, additionalContext: text } };
}

/** Writes `output` as JSON to stdout unless it is null. */
function emit(output) {
  if (output === null || output === undefined) return;
  process.stdout.write(JSON.stringify(output));
}

function sessionsDir() {
  const base = process.env.PLUGIN_DATA || path.join(os.tmpdir(), 'constellation-codex');
  return path.join(base, 'sessions');
}

function sanitizeSessionId(sessionId) {
  return typeof sessionId === 'string' ? sessionId.replace(/[^A-Za-z0-9_-]/g, '') : '';
}

/** The saved state for a session, or {} on any error. */
function loadState(sessionId) {
  try {
    const id = sanitizeSessionId(sessionId);
    if (!id) return {};
    const parsed = JSON.parse(fs.readFileSync(path.join(sessionsDir(), `${id}.json`), 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Atomically saves session state; never throws. */
function saveState(sessionId, state) {
  try {
    const id = sanitizeSessionId(sessionId);
    if (!id) return;
    const dir = sessionsDir();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${id}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, path.join(dir, `${id}.json`));
  } catch {
    // State is best effort.
  }
}

/** Deletes session state files older than seven days; never throws. */
function pruneStates() {
  try {
    const dir = sessionsDir();
    const cutoff = Date.now() - STATE_MAX_AGE_MS;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {
        // Skip files that cannot be inspected.
      }
    }
  } catch {
    // Nothing to prune.
  }
}

module.exports = {
  absolute,
  contextOutput,
  emit,
  isConfigured,
  loadState,
  projectRoot,
  pruneStates,
  readInput,
  saveState,
};

# constellation-codex

Codex plugin for Constellation code intelligence.

## Structure

- `.agents/plugins/marketplace.json`: local marketplace (`constellation-local`).
- `plugins/constellation/.codex-plugin/plugin.json`: plugin manifest.
- `plugins/constellation/.mcp.json`: stdio MCP server config.
- `plugins/constellation/skills/*/SKILL.md`: active `$constellation:*` workflows and skills.
- `plugins/constellation/skills/*/agents/openai.yaml`: per-skill Codex metadata and invocation policy.
- `plugins/constellation/hooks/hooks.json`: Codex `SessionStart`, `SubagentStart`, and `PostToolUse` hooks.
- `plugins/constellation/assets/`: icons.
- Hook files in `plugins/constellation/hooks/`: `lib.js`, `classify.js`, `inject.js`, `bash.js`, `code-intel.js`, `freshness.js`, with `*.test.js` and `fixtures/` beside them; run `npm test`.
- Settings are environment variables (for example `CONSTELLATION_NUDGE_LIMIT`) because Codex plugins have no per-plugin user settings.
- Hook state lives in `PLUGIN_DATA` or `os.tmpdir()/constellation-codex`, pruned after 7 days; hooks fail open within their timeout.

## Rules

- Active behavior belongs in skills and MCP.
- Use `mcp__constellation__code_intel` for structure: symbols, callers, dependencies, impact, architecture, orphaned code.
- Use local text search for literals, configs, logs, and fallback.
- Keep manifest paths plugin-relative.

## Decisions

- MCP server stays on `@constellationdev/mcp@latest`: with a warm npx cache the exact pin and `@latest` start in the same time (median 1.13s each) and both start offline, so pinning gives no startup benefit.
- `mcp_tool` hooks (`type`, `server`, `tool`, `input`, `timeout`, `statusMessage`) call `code_intel` with `{"code": <PROGRAMS literal>, "cwd": "${cwd}", "hook": {"event": "<Event>", "sessionId": "${session_id}", "input": {"tool_name": "${tool_name}", "tool_input": "${tool_input}", "cwd": "${cwd}"}, "settings": ["CONSTELLATION_..."]}}`. Verified against openai/codex `982695cd` (`hooks/src/engine/mcp_runner.rs`): placeholders resolve recursively through objects and arrays, a string that is exactly one placeholder keeps the field's JSON type (so `hook.input.tool_input` is the Bash `{ "command": ... }` object), a missing field fails the hook (so only always-present fields are used, never `agent_id`), every `${...}` in any string is expanded (so program code never contains that sequence), and `input` must be representable as TOML (no `null`).

## Worktrees

Create git worktrees only under this repo's `.claude/worktrees/<branch-slug>` (already gitignored), e.g. `git worktree add .claude/worktrees/feat-x -b feat/x origin/main`. Never create them outside the repo (e.g. sibling `../constellation-<name>-<branch>` folders) or in a `.worktrees/` directory.

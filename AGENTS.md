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
- Planned impact hooks will be `mcp_tool` hooks on the plugin's own `constellation` server calling `code_intel` (the only MCP tool) with a fixed `code` program and the hook input as a structured argument, using a hook output mode that `@constellationdev/mcp` does not have yet. Today's `code_intel` envelope cannot be hook output because Codex hook output is `deny_unknown_fields`, so every call would fail (never block). A warm call takes a median 95ms; the first call of a session can wait on server start (about 1.1 to 1.5s) inside the hook timeout, then fails open.
- Plugin layout stays on `.codex-plugin/plugin.json` and `.mcp.json` until a cross-plugin format decision: portable `mcp.json` cannot forward `CONSTELLATION_ACCESS_KEY` (its `env` expands only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`, Agent Plugins spec 1.0.0 section 9.2), so the overlay with `env_vars` would still be required.
- Distribution stays marketplace-only: the public directory requires no lifecycle hooks and a remote HTTPS MCP endpoint, but this MCP server must run locally to read `constellation.json` and the git branch (OpenAI plugin submission docs, checked 2026-10-19).

## Worktrees

Create git worktrees only under this repo's `.claude/worktrees/<branch-slug>` (already gitignored), e.g. `git worktree add .claude/worktrees/feat-x -b feat/x origin/main`. Never create them outside the repo (e.g. sibling `../constellation-<name>-<branch>` folders) or in a `.worktrees/` directory.

# constellation-codex

Codex plugin for Constellation code intelligence.

## Structure

- `.agents/plugins/marketplace.json`: local marketplace (`constellation-local`).
- `plugins/constellation/.codex-plugin/plugin.json`: plugin manifest.
- `plugins/constellation/.mcp.json`: stdio MCP server config.
- `plugins/constellation/skills/*/SKILL.md`: active `$constellation:*` workflows and skills.
- `plugins/constellation/skills/*/agents/openai.yaml`: per-skill Codex metadata and invocation policy.
- `plugins/constellation/hooks/hooks.json`: Codex `SessionStart`, `SubagentStart` and `PostToolUse` command hooks. The only hooks file the plugin loads; it registers no `mcp_tool` hook, so the plugin makes no `code_intel` call by default.
- `plugins/constellation/hooks/opt-in-hooks.json`: the two `mcp_tool` hooks (`PostToolUse` `Bash` search augmentation, `PreToolUse` `apply_patch|Edit|Write` impact notice) in the hooks.json shape (only `description` and `hooks`), for users to copy into `~/.codex/hooks.json`. Not loaded by the plugin.
- `plugins/constellation/assets/`: icons.
- Hook files in `plugins/constellation/hooks/`: `lib.js`, `classify.js`, `inject.js`, `bash.js`, `code-intel.js`, `freshness.js`, `programs.js`, `primpact.js`, `opt-in-hooks.json`, with `*.test.js` and `fixtures/` beside them; run `npm test`.
- Settings are environment variables (for example `CONSTELLATION_NUDGE_LIMIT`) because Codex plugins have no per-plugin user settings.
- Each `mcp_tool` `code` literal in `opt-in-hooks.json` must equal its `PROGRAMS` entry in `programs.js`. Programs stay self-contained (helpers nested inside the function). `programs.test.js` fails on drift and prints the expected literal.
- Hook state lives in `PLUGIN_DATA` or `os.tmpdir()/constellation-codex`, pruned after 7 days; hooks fail open within their timeout.

## Rules

- Active behavior belongs in skills and MCP.
- Use `mcp__constellation__code_intel` for structure: symbols, callers, dependencies, impact, architecture, orphaned code.
- Use local text search for literals, configs, logs, and fallback.
- Keep manifest paths plugin-relative.

## Decisions

- MCP server stays on `@constellationdev/mcp@latest`: with a warm npx cache the exact pin and `@latest` start in the same time (median 1.13s each) and both start offline, so pinning gives no startup benefit.
- Impact hooks are `mcp_tool` hooks on the plugin's own `constellation` server calling `code_intel` (the only MCP tool) with a fixed `code` program and the hook input as a structured argument, in `@constellationdev/mcp`'s hook mode. The normal `code_intel` envelope cannot be hook output because Codex hook output is `deny_unknown_fields`, so every call would fail (never block). A warm call takes a median 95ms; the first call of a session can wait on server start (about 1.1 to 1.5s) inside the hook timeout, then fails open.
- `mcp_tool` hooks (`type`, `server`, `tool`, `input`, `timeout`, `statusMessage`) call `code_intel` with `{"code": <PROGRAMS literal>, "cwd": "${cwd}", "hook": {"event": "<Event>", "sessionId": "${session_id}", "input": {"tool_name": "${tool_name}", "tool_input": "${tool_input}", "cwd": "${cwd}"}}}`, with no `settings`: adding the hook is the opt-in. Verified against openai/codex `982695cd` (`hooks/src/engine/mcp_runner.rs`): placeholders resolve recursively through objects and arrays, a string that is exactly one placeholder keeps the field's JSON type (so `hook.input.tool_input` is the Bash `{ "command": ... }` object), a missing field fails the hook (so only always-present fields are used, never `agent_id`), every `${...}` in any string is expanded (so program code never contains that sequence), and `input` must be representable as TOML (no `null`).
- The `mcp_tool` hooks are opt-in user hooks, verified against openai/codex `982695cd`: the plugin loads only the manifest's `hooks` path (`core-plugins/src/loader.rs` `load_plugin_hooks`); user hooks come from `hooks.json` beside the user `config.toml` or its `[hooks]` tables (`hooks/src/engine/discovery.rs`, `config/src/state.rs` `hooks_config_folder`); a hooks file accepts only `description` and `hooks` (`config/src/hook_config.rs` `HooksFile`, `deny_unknown_fields`); a user hook runs only once trusted in `/hooks`; and `server` is looked up by name across all MCP servers, plugin ones included under their `.mcp.json` key, with a user `config.toml` server of the same name winning (`codex-mcp/src/catalog.rs`, `connection_manager.rs` `validate_tool_call`).
- Bash hook `tool_input` is only `{ "command": ... }` (`core/src/tools/handlers/unified_exec/exec_command.rs` `pre_tool_use_payload`, and `core/src/tools/context.rs` `post_tool_use_input` for `PostToolUse`): the model's `workdir` never reaches hooks, so `primpact.js` resolves the repository from `cwd` and any `cd <dir>` in the line.
- PR impact runs inside `bash.js` (`PostToolUse` Bash), not as its own hook: a plugin `PreToolUse` Bash hook would start node on every shell command, and a user hook cannot reach the plugin's files because Codex sets `PLUGIN_ROOT` only for plugin hooks (`hooks/src/engine/discovery.rs`). `PostToolUse` Bash fires only when the command finishes inside its yield time, 10 s by default (`core/src/tools/handlers/unified_exec.rs` `default_exec_yield_time_ms`; `post_tool_use_response` is `None` while the process runs).
- Plugin layout stays on `.codex-plugin/plugin.json` and `.mcp.json` until a cross-plugin format decision: portable `mcp.json` cannot forward `CONSTELLATION_ACCESS_KEY` (its `env` expands only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`, Agent Plugins spec 1.0.0 section 9.2), so the overlay with `env_vars` would still be required.
- Distribution stays marketplace-only: the public directory requires no lifecycle hooks and a remote HTTPS MCP endpoint, but this MCP server must run locally to read `constellation.json` and the git branch (OpenAI plugin submission docs, checked 2026-10-19).

## Worktrees

Create git worktrees only under this repo's `.claude/worktrees/<branch-slug>` (already gitignored), e.g. `git worktree add .claude/worktrees/feat-x -b feat/x origin/main`. Never create them outside the repo (e.g. sibling `../constellation-<name>-<branch>` folders) or in a `.worktrees/` directory.

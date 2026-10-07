# constellation-codex

Codex plugin for Constellation code intelligence.

## Structure

- `.agents/plugins/marketplace.json`: local marketplace (`constellation-local`).
- `plugins/constellation/.codex-plugin/plugin.json`: plugin manifest.
- `plugins/constellation/.mcp.json`: stdio MCP server config.
- `plugins/constellation/skills/*/SKILL.md`: active `$constellation:*` workflows and skills.
- `plugins/constellation/skills/*/agents/openai.yaml`: per-skill Codex metadata and invocation policy.
- `plugins/constellation/hooks/hooks.json`: Codex `SessionStart` and `PreToolUse` hooks.
- `output-styles/`: parity reference.
- `plugins/constellation/assets/`: icons.

## Rules

- Active behavior belongs in skills and MCP.
- Use `mcp__constellation__code_intel` for structure: symbols, callers, dependencies, impact, architecture, orphaned code.
- Use local text search for literals, configs, logs, and fallback.
- Keep manifest paths plugin-relative.

## Decisions

- MCP server stays on `@constellationdev/mcp@latest`: with a warm npx cache the exact pin and `@latest` start in the same time (median 1.13s each) and both start offline, so pinning gives no startup benefit.

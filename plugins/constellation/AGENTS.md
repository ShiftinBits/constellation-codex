# constellation-codex

Codex plugin for Constellation code intelligence.

## Structure

- `.codex-plugin/plugin.json`: plugin manifest.
- `.mcp.json`: stdio MCP server config.
- `skills/*/SKILL.md`: active `$constellation:*` workflows.
- `agents/`: compact parity references for source, impact, and dependency analysis.
- `hooks/hooks.json`: Codex `SessionStart` and `PreToolUse` hooks.
- `output-styles/`: parity reference.
- `assets/`: icons.

## Rules

- Active behavior belongs in skills and MCP.
- Use `mcp__constellation__code_intel` for structure: symbols, callers, dependencies, impact, architecture, orphaned code.
- Use local text search for literals, configs, logs, and fallback.
- Keep manifest paths plugin-relative.

## Validate

```bash
python3 -m json.tool .codex-plugin/plugin.json >/dev/null
python3 -m json.tool .mcp.json >/dev/null
python3 -m json.tool hooks/hooks.json >/dev/null
```

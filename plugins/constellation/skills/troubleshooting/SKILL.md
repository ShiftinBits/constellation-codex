---
name: troubleshooting
description: Use when invoking $constellation:troubleshooting.
---

# Constellation Troubleshooting

Use this quick map, then continue with the user's task using fallback tools when possible.

| Symptom or code | Meaning | Fix |
|---|---|---|
| MCP tool missing/fails | MCP server did not start or crashed | Restart Codex; verify `.mcp.json`; run `npx @constellationdev/mcp@latest --version`. |
| `AUTH_ERROR` | Missing, invalid, or expired key | Run `constellation auth`; check `CONSTELLATION_ACCESS_KEY`; regenerate key if needed. |
| `PROJECT_NOT_INDEXED` | Current project has no usable index | Run `constellation index --full`; use `--force` if stale. |
| `API_UNREACHABLE` | API cannot be reached | Check network, service status, and API URL in `constellation.json`. |
| `SYMBOL_NOT_FOUND` / `FILE_NOT_FOUND` | Query target was not found | Try broader terms, check path/case, or re-index recent files. |

Diagnostic order:

1. Try `$constellation:status`.
2. If status is unclear, run `$constellation:diagnose`.
3. For code questions, use local search/read fallbacks if Constellation is unavailable.

See `references/error-codes.md` for the full compact error table.

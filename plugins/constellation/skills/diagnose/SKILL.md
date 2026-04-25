---
name: diagnose
description: Use when invoking $constellation:diagnose.
---

# Constellation Diagnose

Call `mcp__constellation__code_intel`:

```javascript
const result = await api.getArchitectureOverview({ includeMetrics: true });
return {
  success: result.success,
  error: result.error,
  project: result.data?.projectName,
  files: result.data?.metrics?.totalFiles,
  symbols: result.data?.metrics?.totalSymbols
};
```

Report a short health check:

- Tool call failure: MCP unreachable; restart Codex and verify `npx @constellationdev/mcp@latest --version`.
- `success: true`: MCP OK, auth OK, project name, indexed file/symbol counts.
- `AUTH_ERROR`: auth failed; run `constellation auth`.
- `PROJECT_NOT_INDEXED`: project not indexed; run `constellation index --full`.
- `API_UNREACHABLE`: check network and API URL in `constellation.json`.
- Other errors: show code, message, and guidance when present.

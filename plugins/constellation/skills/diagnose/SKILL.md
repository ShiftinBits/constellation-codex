---
name: diagnose
description: "Use only when the user explicitly invokes $constellation:diagnose. Runs a quick health check of Constellation connectivity, authentication, and indexing. Not for code search or analysis."
---

# Constellation Diagnose

Call `mcp__constellation__code_intel`:

```javascript
const result = await api.getArchitectureOverview({});
return {
  success: result.success,
  error: result.error,
  primaryLanguage: result.data?.metadata?.primaryLanguage,
  files: result.data?.metadata?.totalFiles,
  symbols: result.data?.structure?.symbols?.total
};
```

Report a short health check:

- Tool call failure: MCP unreachable; restart Codex and verify `npx @constellationdev/mcp@latest --version`.
- `success: true`: MCP OK, auth OK, primary language, indexed file/symbol counts.
- `AUTH_ERROR`: auth failed; run `constellation auth`.
- `PROJECT_NOT_INDEXED`: project not indexed; run `constellation index --full`.
- `API_UNREACHABLE`: check network and API URL in `constellation.json`.
- Other errors: show code, message, and guidance when present.

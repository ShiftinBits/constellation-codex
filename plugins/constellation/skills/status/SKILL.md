---
name: status
description: Use when invoking $constellation:status.
---

# Constellation Status

Call `mcp__constellation__code_intel`:

```javascript
return await api.ping();
```

If `pong === true`, report connected, authentication valid, and project access confirmed.

For errors:

| Code | Response |
|---|---|
| `AUTH_ERROR` | Auth failed; run `constellation auth`. |
| `PROJECT_NOT_REGISTERED` | Project not found; verify project ID or org access. |
| `PROJECT_INACTIVE` | Project inactive. |
| `API_UNREACHABLE` | API offline; check network and `constellation.json`. |

For other responses, show the error code/message or note an unexpected response. If the tool call fails, report MCP unreachable and suggest `$constellation:diagnose`.

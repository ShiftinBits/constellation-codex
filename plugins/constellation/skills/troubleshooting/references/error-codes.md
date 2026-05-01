# Constellation Error Codes

| Code | Cause | User action |
|---|---|---|
| `AUTH_ERROR` | Access key missing/invalid/expired/revoked | Run `constellation auth`; verify `CONSTELLATION_ACCESS_KEY`. |
| `PROJECT_NOT_INDEXED` | Project has not been indexed | Run `constellation index --full`. |
| `PROJECT_NOT_REGISTERED` | Project ID is unknown or inaccessible | Check project config and organization access. |
| `PROJECT_INACTIVE` | Project is disabled | Reactivate it or select another project. |
| `API_UNREACHABLE` | Network/API URL problem | Check network, service status, and `constellation.json`. |
| `SYMBOL_NOT_FOUND` | Symbol query has no match | Broaden terms, check spelling/case, re-index if new. |
| `FILE_NOT_FOUND` | File path is not indexed | Use repo-relative path; confirm indexed extension/language; re-index. |
| `INVALID_QUERY` | API rejected parameters | Simplify the query and verify required fields. |
| `RATE_LIMITED` | Too many requests | Retry later or reduce repeated calls. |
| `INTERNAL_ERROR` | Server-side failure | Retry; capture request context if it persists. |

For MCP startup failures:

```bash
npx @constellationdev/mcp@latest --version
```

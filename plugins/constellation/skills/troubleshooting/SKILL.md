---
name: troubleshooting
description: Use when invoking $constellation:troubleshooting, when the user reports Constellation errors, MCP server failures, indexing problems, authentication issues, or mentions error codes (AUTH_ERROR, PROJECT_NOT_INDEXED, API_UNREACHABLE, SYMBOL_NOT_FOUND).
---

# Constellation Troubleshooting

Diagnostic procedures for Constellation plugin issues. Continue the user's task with local search/read fallbacks when Constellation is unavailable.

## Quick Diagnosis Flowchart

```
Issue Reported
     |
     v
Can mcp__constellation__code_intel be called?
     |                    |
    YES                   NO
     |                    |
     v                    v
  API Error          MCP Server Issue
 (has error.code)   (see MCP Diagnosis)
     |
     v
Check error.code:
- AUTH_ERROR             --> Authentication section
- PROJECT_NOT_INDEXED    --> Indexing section
- SYMBOL_NOT_FOUND       --> Query Issues section
- API_UNREACHABLE        --> Connectivity section
```

## MCP Server Issues

**Symptom:** MCP tool calls fail entirely, "Failed to connect", or `mcp__constellation__code_intel` is missing.

**Cause:** The MCP server isn't starting or is crashing.

**Quick Fixes:**

1. **Restart Codex** — MCP connections initialize at startup.

2. **Verify the MCP binary works:**

   ```bash
   npx -y @constellationdev/mcp@latest --version
   ```

3. **Verify MCP configuration** — the server is built into the constellation plugin, but the config should match:

   ```json
   {
     "mcpServers": {
       "constellation": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "@constellationdev/mcp@latest"],
         "env": {
           "CONSTELLATION_ACCESS_KEY": "${CONSTELLATION_ACCESS_KEY}"
         }
       }
     }
   }
   ```
   
## Authentication Issues (AUTH_ERROR)

**Symptom:** "Authentication failed" or "Invalid API key"

**Quick Fixes:**

1. **Configure credentials:**

   ```bash
   npx @constellationdev/cli auth
   ```

2. **Check if access key is properly set:**

   On `AUTH_ERROR` failures the MCP server provides details in the `error.guidance[0]` value of the response object, indicating the current state of the `CONSTELLATION_ACCESS_KEY` environment variable.

3. **If key is expired:** Regenerate in the Constellation web UI under Settings > API Keys.

## Indexing Issues (PROJECT_NOT_INDEXED)

**Symptom:** "Project not indexed" or empty results.

**Quick Fixes:**

1. **Index the project:**

   ```bash
   cd /path/to/your/project
   constellation index --full
   ```

2. **Force reindex if stale:**

   ```bash
   constellation index --full --force
   ```

## Connectivity Issues (API_UNREACHABLE)

**Symptom:** Timeout or connection refused.

**Quick Fixes:**

1. **Check network connectivity.**
2. **Check Constellation status** at https://status.constellationdev.io/
3. **Check the API URL** in the project's `constellation.json`.

## Query Issues (SYMBOL_NOT_FOUND, FILE_NOT_FOUND)

These are typically **not errors** — the item simply wasn't found in the index.

**Troubleshooting:**

1. Try partial/broader search terms.
2. Check spelling and case sensitivity.
3. Verify the file extension is in configured languages.
4. Re-index if the file was recently added.

## Diagnostic Order

1. Try `$constellation:status` for a quick connectivity/auth check.
2. If status is unclear, run `$constellation:diagnose` for a full health report (MCP, auth, indexing).
3. For code questions when Constellation is unavailable, fall back to local text search and file reads — note the degraded mode to the user.

## Error Code Quick Reference

| Code | Cause | Fix |
|------|-------|-----|
| `AUTH_ERROR` | Missing/invalid/expired API key | `constellation auth` |
| `PROJECT_NOT_INDEXED` | Project needs indexing | `constellation index --full` |
| `SYMBOL_NOT_FOUND` | Typo or stale index | Broader search or re-index |
| `FILE_NOT_FOUND` | Path mismatch or stale index | Verify path; re-index |
| `API_UNREACHABLE` | API not running / network issue | Check network, status page, API URL |

See `references/error-codes.md` for the complete error code reference.

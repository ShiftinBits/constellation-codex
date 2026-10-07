---
name: get-started
description: "Use to set up Constellation, or when the access key is missing, the project is not indexed, or constellation.json is missing. Walks through installing the CLI, authenticating, initializing, indexing, and verifying. Not for code search or analysis."
---

# Get Started with Constellation

Walk the user through these steps in order. Skip any step they have already completed.

1. Install the CLI: `npm install -g @constellationdev/cli`, or run it on demand with `npx @constellationdev/cli`.
2. Run `constellation auth` to set `CONSTELLATION_ACCESS_KEY`. The key must start with `ak:`.
3. From the project root, run `constellation init` to create `constellation.json`.
4. Run `constellation index` to index the project. Use `constellation index --full` if the project was indexed before and results look stale.
5. Restart Codex so the MCP server receives the key through its `env_vars` setting.
6. Open `/hooks` and trust the Constellation hooks.
7. Run `$constellation:status` to confirm the connection.

macOS note: GUI apps such as the ChatGPT desktop app may hold a stale environment. After `constellation auth`, fully quit and relaunch the app so it picks up the new `CONSTELLATION_ACCESS_KEY`.

## Common errors

| Code | Cause | User action |
|---|---|---|
| `AUTH_ERROR` | Access key missing/invalid/expired/revoked | Run `constellation auth`; verify `CONSTELLATION_ACCESS_KEY`. |
| `PROJECT_NOT_INDEXED` | Project has not been indexed | Run `constellation index --full`. |
| `PROJECT_NOT_REGISTERED` | Project ID is unknown or inaccessible | Check project config and organization access. |
| `API_UNREACHABLE` | Network/API URL problem | Check network, service status, and `constellation.json`. |

For MCP startup failures:

```bash
npx @constellationdev/mcp@latest --version
```

For anything else, suggest `$constellation:diagnose`.

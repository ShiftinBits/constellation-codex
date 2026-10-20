# <img src="https://constellationdev.io/openai-icon.svg" height="30"> Constellation Plugin for Codex

[![MCP Server](https://img.shields.io/badge/mcp-@constellationdev/mcp-black.svg?logo=modelcontextprotocol)](https://github.com/ShiftinBits/constellation-mcp) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE)

While Constellation's MCP server provides raw code intelligence capabilities, this plugin enhances your Codex experience with:

| Feature | Benefit |
|---------|---------|
| **Constellation Skills** | `$constellation:` workflows for common code intelligence tasks |
| **Troubleshooting Skill** | Targeted diagnostics for auth, indexing, API, and MCP failures |
| **Impact Skill** | Pre-change blast-radius guidance before refactors, renames, or deletions |
| **Hooks** | Setup checks, session guidance, and reminders to prefer `code_intel` over text search for structural queries |

## Features

### Skills

Reusable `$constellation:` skills for structural analysis and plugin diagnostics. Codex also selects `impact`, `deps`, `unused`, `architecture`, and `troubleshooting` on its own when a request matches; `status` and `diagnose` run only when you invoke them:

| Skill | Description |
|---------|-------------|
| `$constellation:get-started` | Set up Constellation: install the CLI, authenticate, initialize, index, and verify |
| `$constellation:status` | Check API connectivity and project indexing status |
| `$constellation:diagnose` | Quick health check for connectivity and authentication |
| `$constellation:impact <symbol> [file]` | Analyze blast radius before changing a symbol |
| `$constellation:deps <file> [--reverse]` | Map dependencies or find what depends on a file |
| `$constellation:unused` | Discover orphaned exports and dead code |
| `$constellation:architecture` | Get a high-level overview of your codebase structure |
| `$constellation:troubleshooting` | Diagnose Constellation errors, indexing problems, auth issues, and MCP failures |

### Hooks

Event hooks enable intelligent, transparent assistance:

| Hook | Event | Behavior |
|------|-------|----------|
| **Session guidance** | `SessionStart` | Establishes `code_intel` as the primary tool for code search and navigation. On startup, tells you when `CONSTELLATION_ACCESS_KEY` is missing or invalid and points to `$constellation:get-started`, and tells Codex when the project is not indexed |
| **Subagent guidance** | `SubagentStart` | Gives subagents the same `code_intel` guidance |
| **Symbol search nudge** | `PostToolUse` (`Bash`) | When a shell search such as `grep` or `rg` looks like a symbol lookup in an indexed project, reminds Codex that `code_intel` finds definitions and usages across files |
| **Freshness note** | `PostToolUse` (`Bash`) | After a git command that moves HEAD (`commit`, `pull`, `checkout`, `merge`, `rebase`), warns once per HEAD when the index is behind your checkout and suggests `constellation index` |
| **Search augmentation** (opt-in) | `PostToolUse` (`Bash`, `mcp_tool`) | When a shell search looks like a symbol lookup and `CONSTELLATION_AUGMENT_SEARCH` is on, adds where the symbol is defined and how many usages it has |
| **Impact notice** (opt-in) | `PreToolUse` (`apply_patch\|Edit\|Write`, `mcp_tool`) | When `CONSTELLATION_IMPACT_NOTICE` is on, notes files a patch touches that have many dependents (high or critical risk), with top dependents, used symbols, and test exposure |
| **PR impact** (opt-in) | `PreToolUse` (`Bash`, `command`) | When `CONSTELLATION_PR_IMPACT=inform`, adds an Impact skeleton to guidance before a `gh pr create` |
| **Usage tracking** | `PostToolUse` (`mcp__constellation__code_intel`) | Records that `code_intel` was used so nudges stay quiet for that turn, and remembers which commit the index reflects |

All hooks except the setup check require an `ak:` access key and a `constellation.json` in the project tree (or, when Codex starts in a folder above several projects, in one of its subdirectories), so they stay silent elsewhere. Nudges are limited per session (3 by default, tracked separately for each subagent). Hooks never send source code anywhere and their output never includes source code; only symbol names and project-relative paths reach the API. They fail open if anything goes wrong.

The three opt-in hooks are off by default. The two `mcp_tool` hooks call the `constellation` MCP server's `code_intel` tool in hook mode, so they need an `@constellationdev/mcp` release that supports hook mode. On older servers, and on the first call while the server is still starting, they fail open and show a `Failed` hook row. Do not define a server named `constellation` in your own `config.toml`, because it would shadow the plugin's server and break these hooks.

Hooks are on by default (`[features].hooks = false` turns them off). After install, and after any plugin update, open `/hooks` in Codex and re-trust the Constellation hooks, or they will not run.

### Settings

`CONSTELLATION_NUDGE_LIMIT` sets how many symbol search nudges Codex gets per session (default `3`; `0` disables nudges). Set it in the environment Codex is launched from. Codex plugins have no per-plugin user settings, so environment variables are the settings mechanism.

| Variable | Default | Effect |
|----------|---------|--------|
| `CONSTELLATION_AUGMENT_SEARCH` | off | `1` or `true` enables search augmentation. The symbol nudge still fires with augmentation on unless `CONSTELLATION_NUDGE_LIMIT=0` |
| `CONSTELLATION_IMPACT_NOTICE` | off | `1` or `true` enables the impact notice before patches |
| `CONSTELLATION_PR_IMPACT` | off | `inform` enables the PR impact hook |

## Installation

### Prerequisites

1. **Constellation Account** (see [Constellation](https://app.constellationdev.io))
2. **Project indexed** in Constellation
3. **Access key** configured

Not sure where you are? Run `$constellation:get-started` for guided setup.

### Quick Start

```bash
# Add the marketplace to Codex
codex plugin marketplace add ShiftinBits/constellation-codex

# Install the Constellation Codex plugin
codex plugin add constellation@constellation-local
```

You can also browse and install from the Codex CLI `/plugins` browser or the ChatGPT desktop app Plugins Directory. The Codex IDE extension does not support plugins.

### Reduce approval prompts

Optionally let Codex call the Constellation MCP tools without asking each time. Add this to `~/.codex/config.toml`:

```toml
[plugins."constellation@constellation-local".mcp_servers.constellation]
default_tools_approval_mode = "approve"
```

## Usage Examples

### Check API Status

```
> $constellation:status

Status: Connected
Project: my-awesome-app
Files Indexed: 1,247
Symbols: 8,932
Languages: TypeScript, JavaScript
```

### Diagnose Setup Issues

```
> $constellation:diagnose

Constellation Health Check
===========================
MCP Server:  OK
API Auth:    OK
Project:     my-awesome-app
Index:       1,247 files, 8,932 symbols

All systems operational.
```

### Understand Architecture

```
> $constellation:architecture

Project Summary
- Files: 1,247
- Symbols: 8,932
- Languages: TypeScript, JavaScript

Dependency Hotspots
- src/services
- src/controllers
- src/utils
```

### Analyze Before Refactoring

```
> $constellation:impact validateUser src/auth/validator.ts

Symbol: validateUser (function)
Risk Level: MEDIUM
Files Affected: 12
Symbols Affected: 34
Impacted Test Files: 3

Recommendations:
- Update unit tests in auth.spec.ts
- Check integration with UserController
```

### Find Dead Code

```
> $constellation:unused function

Found 7 orphaned functions:
├── src/utils/legacy.ts
│   ├── formatLegacyDate (line 23)
│   └── parseLegacyConfig (line 45)
├── src/helpers/deprecated.ts
│   └── oldValidation (line 12)
...
```

### Understand Dependencies

```
> $constellation:deps src/services/payment.service.ts

Dependencies (12):
├── Internal (8)
│   ├── src/models/payment.model.ts
│   ├── src/utils/currency.ts
│   └── ...
└── External (4)
    ├── stripe
    ├── lodash
    └── ...

No circular dependencies detected.
```

### Troubleshoot Constellation

```
> $constellation:troubleshooting AUTH_ERROR

Issue: Authentication failed - API key missing or invalid.
Quick Fix: Run `constellation auth` in your shell.
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `AUTH_ERROR` | Check `CONSTELLATION_ACCESS_KEY` is set correctly, then run `constellation auth` in your shell |
| `PROJECT_NOT_INDEXED` | Run `constellation index --full` in your project |
| Skills not appearing | Restart Codex or check plugin path |
| Missing key, no `constellation.json`, or hooks not running | Run `$constellation:get-started` |

## Documentation

- [Constellation Documentation](https://docs.constellationdev.io) - Full platform documentation
- [MCP Server](https://github.com/shiftinbits/constellation-mcp) - Underlying MCP server
- [Codex Plugins](https://developers.openai.com/codex) - Plugin development guide

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

Copyright © 2026 ShiftinBits Inc.

See [LICENSE](LICENSE) file for details.

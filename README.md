# <img src="https://constellationdev.io/openai-icon.svg" height="30"> Constellation Plugin for Codex

[![MCP Server](https://img.shields.io/badge/mcp-@constellationdev/mcp-black.svg?logo=modelcontextprotocol)](https://github.com/ShiftinBits/constellation-mcp) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE)

While Constellation's MCP server provides raw code intelligence capabilities, this plugin enhances your Codex experience with:

| Feature | Benefit |
|---------|---------|
| **Constellation Skills** | `$constellation:` workflows for common code intelligence tasks |
| **Troubleshooting Skill** | Targeted diagnostics for auth, indexing, API, and MCP failures |
| **Reference Agents** | Specialist prompts for exploration, impact, and dependency review |
| **Safety Hooks** | Reminders to check impact before modifying code |

## Features

### Skills

Reusable `$constellation:` skills for structural analysis and plugin diagnostics:

| Skill | Description |
|---------|-------------|
| `$constellation:status` | Check API connectivity and project indexing status |
| `$constellation:diagnose` | Quick health check for connectivity and authentication |
| `$constellation:impact <symbol> <file>` | Analyze blast radius before changing a symbol |
| `$constellation:deps <file> [--reverse]` | Map dependencies or find what depends on a file |
| `$constellation:unused` | Discover orphaned exports and dead code |
| `$constellation:architecture` | Get a high-level overview of your codebase structure |
| `$constellation:troubleshooting` | Diagnose Constellation errors, indexing problems, auth issues, and MCP failures |

### Agents

Specialized prompts for autonomous analysis:

| Agent | Purpose |
|-------|---------|
| **source-scout** | Explores and navigates codebase, discovers symbols and architectural patterns |
| **impact-investigator** | Proactively assesses risk before refactoring, renaming, or deleting code |
| **dependency-detective** | Detects circular dependencies and unhealthy coupling patterns |

**Example Trigger:**
```
You: "Rename AuthService to AuthenticationService"
Codex: "Before renaming, let me analyze the potential impact..."
[Loads impact-investigator workflow]
```

### Hooks

Event hooks enable intelligent, transparent assistance:

| Hook | Event | Behavior |
|------|-------|----------|
| **Session Start** | `SessionStart` | Establishes Constellation as the primary code intelligence source |
| **Pre Tool Use** | `PreToolUse` | Matches `Bash` to remind Codex to prefer Constellation before shell text search for structural code queries |

Hooks require Codex hooks to be enabled with `codex_hooks`.

## Installation

### Prerequisites

1. **Constellation Account** (see [Constellation](https://app.constellationdev.io))
2. **Project indexed** in Constellation
3. **Access key** configured

### Quick Start

```bash
# Add the marketplace to Codex
codex plugin marketplace add ShiftinBits/constellation-codex

# Install the Constellation Codex plugin
codex plugin install constellation@constellation-plugins
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

Key Directories
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
Test Coverage: 67%

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

## Documentation

- [Constellation Documentation](https://docs.constellationdev.io) — Full platform documentation
- [MCP Server](https://github.com/shiftinbits/constellation-mcp) — Underlying MCP server
- [Codex Plugins](https://developers.openai.com/codex) — Plugin development guide

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

Copyright © 2026 ShiftinBits Inc.

See [LICENSE](LICENSE) file for details.

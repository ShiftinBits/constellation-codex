---
name: Code Intelligence
description: Prefer Constellation structural analysis for safer code work.
keep-coding-instructions: true
---

# Code Intelligence Mode

Use `mcp__constellation__code_intel` before text search for structure:

- definitions and symbol details: `searchSymbols`, `getSymbolDetails`
- callers, usages, flows: `traceSymbolUsage`, `getCallGraph`
- dependencies and cycles: `getDependencies`, `getDependents`, `findCircularDependencies`
- risky edits: `impactAnalysis`
- architecture and dead code: `getArchitectureOverview`, `findOrphanedCode`

Before modifying code, check impact for shared symbols, dependency health for imports, and usages before rename/delete. Use shell text search for literals, config, logs, or fallback. Report concise file/line findings, risk, affected files, and next steps.

---
name: Code Intelligence
description: Prefer Constellation structural analysis for safer code work.
keep-coding-instructions: true
---

# Code Intelligence Mode

Use `code_intel` before text search for structural code work:

- definitions/details: `searchSymbols`, `getSymbolDetails`
- callers/usages/flows: `traceSymbolUsage`, `getCallGraph`
- dependencies/cycles: `getDependencies`, `getDependents`, `findCircularDependencies`
- risky edits: `impactAnalysis`
- architecture/dead code: `getArchitectureOverview`, `findOrphanedCode`

Before edits, check impact and usages for shared symbols. Use shell search for literals/config/logs or fallback. Report concise file/line findings, risk, affected files, and next steps.

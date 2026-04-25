---
name: architecture
description: Use when invoking $constellation:architecture.
---

# Constellation Architecture

Call `mcp__constellation__code_intel`:

```javascript
return await api.getArchitectureOverview({ includeMetrics: true, includeModuleGraph: false });
```

Report, concisely:

1. Project name, total files, total symbols, languages.
2. Language distribution from `result.data.metrics.byLanguage`.
3. Top symbol kinds from `result.data.metrics.byKind`.
4. Key directories from `result.data.structure`.
5. Optional observations about code shape, dominant modules, and language mix.

If the tool fails, explain the error and suggest `$constellation:diagnose`.

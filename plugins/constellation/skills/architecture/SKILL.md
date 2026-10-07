---
name: architecture
description: "Use to explain codebase structure, module layout, languages, and dependency hotspots, or to orient in an unfamiliar project. Not for literal string, config, or log search."
---

# Constellation Architecture

Call `mcp__constellation__code_intel`:

```javascript
return await api.getArchitectureOverview({ includeMetrics: true, includeModuleGraph: false });
```

Report, concisely:

1. Primary language and frameworks from `result.data.metadata`, total files (`result.data.metadata.totalFiles`), total symbols (`result.data.structure.symbols.total`).
2. Language distribution from `result.data.metadata.languages`.
3. Top symbol kinds from `result.data.structure.symbols.byKind`.
4. Dependency hotspots from `result.data.dependencies.internal.mostConnectedFiles` and top packages from `result.data.dependencies.external.topPackages`.
5. Optional observations about code shape, dominant modules, and language mix.

If the tool fails, explain the error and suggest `$constellation:diagnose`.

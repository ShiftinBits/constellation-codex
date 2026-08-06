---
name: impact-analysis
description: Use when invoking $constellation:impact.
---

# Constellation Impact

Read symbol name and optional file path from the user. If no symbol is provided, ask for it.

Call `mcp__constellation__code_intel`:

```javascript
const filePath = undefined; // Use a string when provided.
return await api.impactAnalysis({
  symbolName: "<symbol name>",
  filePath,
  depth: 3
});
```

Report symbol, risk level (`data.breakingChangeRisk.riskLevel`), affected files (`data.summary.impactedFileCount`), export status (`data.symbol.isExported`), direct dependents, test exposure (`data.summary.testFileCount` vs `productionFileCount`), and recommendations (`data.breakingChangeRisk.recommendations`). Emphasize caution for high or critical risk. If the API returns an error, explain it and include any guidance.

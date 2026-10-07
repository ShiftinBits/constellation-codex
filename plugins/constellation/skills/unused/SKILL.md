---
name: unused
description: "Use to find dead code, unused or orphaned exports, and unreferenced functions, classes, types, or variables before cleanup. Not for literal string, config, or log search."
---

# Constellation Unused

Read the optional kind filter: `function`, `class`, `type`, `interface`, or `variable`.

Call `mcp__constellation__code_intel`:

```javascript
const kindFilter = ""; // Replace when the user provides a kind.
const params = kindFilter ? { filterByKind: [kindFilter] } : {};
return await api.findOrphanedCode(params);
```

If orphans are found, summarize total count, group by file, and list symbol names, kinds, and orphan reasons (each result includes reason and a confidence score; lineEnd is present when known). Remind the user to confirm dynamic entry points before deletion. If none are found, say so. If the API returns an error, explain it and include any guidance.

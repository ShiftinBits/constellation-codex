---
name: deps
description: Use when invoking $constellation:deps.
---

# Constellation Deps

Read the file path and optional `--reverse` or `-r` flag from the user.

For normal dependency analysis:

```javascript
const filePath = "<file path>";
const [dependencies, circularDependencies] = await Promise.all([
  api.getDependencies({ filePath, depth: 2, includePackages: true }),
  api.findCircularDependencies({ filePath, maxDepth: 5 })
]);
return { dependencies, circularDependencies };
```

For reverse dependency analysis:

```javascript
const filePath = "<file path>";
return await api.getDependents({ filePath, depth: 2 });
```

Present counts, internal files, external packages, dependents when requested, and any cycles. If no file path is provided, ask for one.

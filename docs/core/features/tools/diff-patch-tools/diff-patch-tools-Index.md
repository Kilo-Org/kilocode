# Tools - Diff/Patch Tools

**Quick Navigation for AI Agents**

---

## Overview

Tools for applying code changes via unified diffs and patches. Critical for code modification workflows.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| ApplyDiffTool | Apply single unified diff | `ApplyDiffTool.ts` | 11KB |
| MultiApplyDiffTool | Apply multiple diffs | `MultiApplyDiffTool.ts` | 28KB |
| ApplyPatchTool | Apply patch files | `ApplyPatchTool.ts` | 15KB |

---

## ApplyDiffTool

**Purpose**: Apply a single unified diff to a file

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | Target file path |
| diff | string | Yes | Unified diff content |

**Diff Format**:
```diff
--- a/file.ts
+++ b/file.ts
@@ -10,5 +10,6 @@
 unchanged line
-removed line
+added line
 unchanged line
```

---

## MultiApplyDiffTool

**Purpose**: Apply multiple diffs in a single operation (28KB - complex)

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| diffs | array | Yes | Array of diff objects |

**Each diff object**:
```typescript
{
  path: string;      // File path
  diff: string;      // Diff content
}
```

---

## ApplyPatchTool

**Purpose**: Apply patch files (git-style patches)

**Source Location**: `src/core/tools/apply-patch/`

**Sub-components**:
| File | Purpose |
|------|---------|
| `apply.ts` | Core patch application logic |
| `parser.ts` | Patch file parser |
| `seek-sequence.ts` | Seek/search sequences |

---

## Diff Strategies

**Location**: `src/core/diff/strategies/`

Different strategies for applying diffs based on context:
- Exact match strategy
- Fuzzy match strategy
- Line-based strategy

---

## Related

- [File Tools](../file-tools/) - Basic file operations
- [Task](../../task/) - Tool execution context

---

[← Back to Tools](../tools-Index.md)

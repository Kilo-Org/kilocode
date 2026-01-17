# Integrations - Editor Feature

**Quick Navigation for AI Agents**

---

## Overview

VS Code editor integration. Handles diff views, code decorations, and editor utilities.

**Source Location**: `src/integrations/editor/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| DiffViewProvider | Class | `DiffViewProvider.ts` | 26KB |
| DecorationController | Class | `DecorationController.ts` | 2KB |
| EditorUtils | Functions | `EditorUtils.ts` | 6KB |

---

## DiffViewProvider

Shows side-by-side diff view for file changes.

**Features**:
- Side-by-side comparison
- Syntax highlighting
- Accept/reject changes
- Navigate between changes

**Key Methods**:
| Method | Purpose |
|--------|---------|
| `showDiff()` | Display diff view |
| `applyChanges()` | Apply accepted changes |
| `rejectChanges()` | Reject changes |
| `close()` | Close diff view |

---

## DecorationController

Manages code decorations (highlights, markers).

**Features**:
- Highlight changed lines
- Show inline markers
- Status indicators

---

## EditorUtils

Utility functions for editor operations.

**Functions**:
| Function | Purpose |
|----------|---------|
| `getActiveEditor()` | Get current editor |
| `getSelectedText()` | Get selection |
| `insertText()` | Insert at cursor |
| `replaceSelection()` | Replace selected text |

---

## Related

- [Diff/Patch Tools](../../../core/features/tools/diff-patch-tools/) - Apply diffs
- [File Tools](../../../core/features/tools/file-tools/) - Edit files

---

[← Back to Integrations](../../Feature-Index.md)

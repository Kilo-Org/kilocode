# Integrations - Diagnostics Feature

**Quick Navigation for AI Agents**

---

## Overview

VS Code diagnostics integration. Displays errors, warnings, and information from VS Code's diagnostic system.

**Source Location**: `src/integrations/diagnostics/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| DiagnosticsService | Class | `index.ts` | 3KB |

---

## Features

- **Error Display**: Show compilation errors
- **Warning Display**: Show warnings
- **Info Display**: Show information messages
- **File Mapping**: Map diagnostics to files

---

## Diagnostic Types

| Type | Description |
|------|-------------|
| Error | Compilation/syntax errors |
| Warning | Potential issues |
| Information | Informational messages |
| Hint | Suggestions |

---

## Quick Reference

| Operation | Description |
|-----------|-------------|
| Get diagnostics | Retrieve all diagnostics |
| Filter by file | Get diagnostics for file |
| Filter by severity | Get errors only |

---

## Integration with @mentions

Use `@problems` mention to include diagnostics in context:
- Shows current file errors
- Helps AI understand issues
- Enables targeted fixes

---

## Related

- [Context](../../../core/features/context/) - @mentions system

---

[← Back to Integrations](../../Feature-Index.md)

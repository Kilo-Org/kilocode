# Core - Ignore/Protect Feature

**Quick Navigation for AI Agents**

---

## Overview

File ignore and protection systems. Prevents AI from reading/modifying certain files based on patterns.

**Source Location**: `src/core/ignore/`, `src/core/protect/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| RooIgnoreController | Class | `ignore/RooIgnoreController.ts` | 6KB |
| RooProtectedController | Class | `protect/RooProtectedController.ts` | 3KB |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Check ignored | `isIgnored()` | `RooIgnoreController.ts` |
| Add ignore pattern | `addPattern()` | `RooIgnoreController.ts` |
| Check protected | `isProtected()` | `RooProtectedController.ts` |

---

## .rooignore

Similar to .gitignore, defines files to exclude:

```
# Ignore node_modules
node_modules/

# Ignore build output
dist/
build/

# Ignore secrets
.env
*.key
```

---

## Protected Files

Files that cannot be modified:
- System files
- Configuration files (optionally)
- Files marked as protected

---

## Use Cases

- **Ignore**: Don't include in context
- **Protect**: Can read but not modify

---

[← Back to Core](../../Feature-Index.md)

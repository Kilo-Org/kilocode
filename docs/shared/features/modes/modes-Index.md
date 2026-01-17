# Shared - Modes Feature

**Quick Navigation for AI Agents**

---

## Overview

Shared mode definitions and utilities. Defines custom modes that control AI behavior, permissions, and capabilities.

**Source Location**: `src/shared/modes.ts`
**Size**: 9KB

---

## Built-in Modes

| Mode | Slug | Description |
|------|------|-------------|
| Code | `code` | Software engineer mode |
| Architect | `architect` | System design mode |
| Ask | `ask` | Question answering mode |

---

## Mode Structure

```typescript
interface Mode {
  slug: string;           // Unique identifier
  name: string;           // Display name
  roleDefinition: string; // AI role description
  groups?: string[];      // Tool permission groups
  customInstructions?: string;
}
```

---

## Key Functions

| Function | Purpose |
|----------|---------|
| `getModeBySlug()` | Get mode by slug |
| `defaultModeSlug` | Get default mode |
| `getGroupName()` | Get group display name |

---

## Tool Groups

Modes can grant access to tool groups:

| Group | Tools Included |
|-------|----------------|
| `read` | Read files, search |
| `edit` | Write, edit files |
| `execute` | Run commands |
| `browser` | Browser automation |
| `mcp` | MCP tools |

---

## Custom Modes

Users can create custom modes with:
- Custom role definitions
- File access patterns (regex)
- Allowed/denied tools
- Custom instructions

---

## Related

- [Config Feature](../../../core/features/config/) - CustomModesManager

---

[← Back to Shared](../../Feature-Index.md)

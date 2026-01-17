# Core - Context Feature

**Quick Navigation for AI Agents**

---

## Overview

Context management for Kilocode. Handles conversation context, token tracking, @mentions, and context condensation to optimize AI interactions.

**Source Location**: `src/core/context-management/`, `src/core/mentions/`, `src/core/condense/`

---

## Components

| Component | Type | Location | Size |
|-----------|------|----------|------|
| ContextManagement | Module | `context-management/index.ts` | 13KB |
| FileContextTracker | Class | `context-tracking/FileContextTracker.ts` | 8KB |
| Mentions | Module | `mentions/index.ts` | 15KB |
| Condense | Module | `condense/index.ts` | - |

---

## Documentation Files

- **[ContextManagement.md](./ContextManagement.md)** - Token and context tracking
- **[Mentions.md](./Mentions.md)** - @mention processing
- **[Condense.md](./Condense.md)** - Context condensation

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Track context | `trackContext()` | `context-management/` |
| Get token count | `getTokenCount()` | `context-management/` |
| Process mentions | `processMentions()` | `mentions/index.ts` |
| Condense context | `condense()` | `condense/index.ts` |
| Track file | `trackFile()` | `FileContextTracker.ts` |

---

## @Mentions

Supported mention types:
- `@file` - Include file content
- `@folder` - Include folder contents
- `@url` - Fetch URL content
- `@git` - Git information
- `@problems` - VS Code problems
- `@terminal` - Terminal output

---

## Context Condensation

When context exceeds limits:
1. Identify condensable content
2. Summarize older messages
3. Preserve critical information
4. Reduce token count

---

## Token Management

- **Budget**: Track token usage per conversation
- **Truncation**: Truncate large content
- **Prioritization**: Keep important context

---

## Related Features

- [Task](../task/) - Context used during task execution
- [Prompts](../prompts/) - System prompts include context

---

[← Back to Core](../../Feature-Index.md)

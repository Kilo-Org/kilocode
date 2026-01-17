# Core - Task Feature

**Quick Navigation for AI Agents**

---

## Overview

Central task management system for Kilocode. The Task class (184KB) is the largest and most critical file in the codebase. Handles task lifecycle, tool execution, message handling, and state management.

**Source Location**: `src/core/task/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| Task | Class | `Task.ts` | 184KB |
| build-tools | Functions | `build-tools.ts` | - |
| validateToolResultIds | Function | `validateToolResultIds.ts` | - |
| AskIgnoredError | Error class | `AskIgnoredError.ts` | - |
| kilocode | Kilocode-specific | `kilocode.ts` | - |

---

## Documentation Files

- **[Types.md](./Types.md)** - Task types, interfaces, enums, error classes
- **[Implementation.md](./Implementation.md)** - Task.ts key methods (50+ methods)

---

## Quick Reference

| Operation | Method | Location |
|-----------|--------|----------|
| Create task | `constructor()` | `Task.ts` |
| Start task | `start()` | `Task.ts` |
| Handle message | `handleMessage()` | `Task.ts` |
| Execute tool | `executeTool()` | `Task.ts` |
| Complete task | `complete()` | `Task.ts` |
| Abort task | `abort()` | `Task.ts` |
| Get state | `getState()` | `Task.ts` |

---

## Task Lifecycle

```
IDLE → RUNNING → COMPLETED
         ↓          ↑
       PAUSED ──────┘
         ↓
       FAILED
```

---

## Key Concepts

- **Task**: Represents a single conversation/task with the AI
- **Tool Execution**: Tasks invoke tools (read file, execute command, etc.)
- **Message Handling**: Processes AI responses and user input
- **State Persistence**: Tasks can be saved and restored

---

## Dependencies

- **Internal**: `tools/`, `context-management/`, `prompts/`
- **External**: API providers, VS Code API

---

## Related Features

- [Tools](../tools/) - Tool implementations executed by tasks
- [Context](../context/) - Context management for tasks
- [Checkpoints](../checkpoints/) - Task state persistence

---

[← Back to Core](../../Feature-Index.md)

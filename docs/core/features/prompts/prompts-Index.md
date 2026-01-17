# Core - Prompts Feature

**Quick Navigation for AI Agents**

---

## Overview

System prompt generation for Kilocode. Creates prompts that define AI behavior, available tools, and instructions.

**Source Location**: `src/core/prompts/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| system | Functions | `system.ts` | 8KB |
| commands | Functions | `commands.ts` | 12KB |
| responses | Functions | `responses.ts` | 13KB |
| types | Types | `types.ts` | - |

---

## Documentation Files

- **[SystemPrompts.md](./SystemPrompts.md)** - System prompt generation
- **[ToolPrompts.md](./ToolPrompts.md)** - Tool documentation in prompts

---

## Directory Structure

```
prompts/
├── system.ts           → Main system prompt
├── commands.ts         → Command prompts
├── responses.ts        → Response templates
├── types.ts            → Type definitions
├── instructions/       → Instruction sections
├── sections/           → Prompt sections
├── tools/              → Tool documentation
└── utilities/          → Prompt utilities
```

---

## Quick Reference

| Operation | Function | File |
|-----------|----------|------|
| Build system prompt | `buildSystemPrompt()` | `system.ts` |
| Get tool docs | `getToolDocumentation()` | `tools/` |
| Get instructions | `getInstructions()` | `instructions/` |

---

## System Prompt Structure

1. **Role definition**: From custom mode
2. **Tool documentation**: Available tools
3. **Instructions**: Mode-specific instructions
4. **Context**: Environment, files, etc.
5. **Rules**: Behavioral rules

---

## Related Features

- [Config](../config/) - Modes define prompt content
- [Tools](../tools/) - Tool docs included in prompts

---

[← Back to Core](../../Feature-Index.md)

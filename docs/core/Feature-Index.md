# Core Module Features

**Quick Navigation for AI Agents**

---

## Overview

Core business logic for Kilocode. Contains task management, 30+ built-in tools, context handling, configuration, prompts, and the agent manager system.

**Source Location**: `src/core/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[task](./features/task/)** | Central task management (184KB main file) | `Task.ts`, `build-tools.ts` |
| **[tools](./features/tools/)** | 30+ built-in tools (file, diff, search, execute) | `ReadFileTool.ts`, `ApplyDiffTool.ts` |
| **[context](./features/context/)** | Context management, @mentions, condensation | `context-management/`, `mentions/` |
| **[config](./features/config/)** | Modes, provider settings, configuration | `CustomModesManager.ts`, `ProviderSettingsManager.ts` |
| **[agent-manager](./features/agent-manager/)** | CLI agent management (67KB main file) | `AgentManagerProvider.ts`, `CliProcessHandler.ts` |
| **[prompts](./features/prompts/)** | System prompts, instructions, tool prompts | `system.ts`, `commands.ts` |
| **[checkpoints](./features/checkpoints/)** | Task checkpoints and restore | `checkpoints/index.ts` |
| **[auto-approval](./features/auto-approval/)** | Auto-approval system | `AutoApprovalHandler.ts` |
| **[messages](./features/messages/)** | Message parsing and handling | `AssistantMessageParser.ts`, `message-manager/` |
| **[ignore-protect](./features/ignore-protect/)** | File ignore and protection | `RooIgnoreController.ts`, `RooProtectedController.ts` |

---

## Key Entry Points

| Purpose | File Path |
|---------|-----------|
| Extension entry | `src/extension.ts` |
| Task creation | `src/core/task/Task.ts` |
| Tool execution | `src/core/tools/BaseTool.ts` |
| Configuration | `src/core/config/ContextProxy.ts` |

---

## Architecture

```
core/
├── task/              → Task lifecycle management
├── tools/             → Tool implementations
├── context-management/→ Token and context tracking
├── config/            → Configuration managers
├── prompts/           → System prompt generation
├── kilocode/          → Agent manager (Kilocode-specific)
├── auto-approval/     → Auto-approval logic
├── checkpoints/       → State persistence
└── mentions/          → @mention processing
```

---

[← Back to Index](../Index.md)

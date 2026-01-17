# CLI - Services Feature

**Quick Navigation for AI Agents**

---

## Overview

CLI-specific services. Handle approval decisions, autocompletion, command execution, and more.

**Source Location**: `cli/src/services/`

---

## Components

| Service | File | Size | Purpose |
|---------|------|------|---------|
| ApprovalDecision | `approvalDecision.ts` | 12KB | Handle tool approvals |
| Autocomplete | `autocomplete.ts` | 21KB | Input autocompletion |
| CommandExecutor | `commandExecutor.ts` | 5KB | Execute CLI commands |
| Extension | `extension.ts` | 14KB | VS Code extension integration |
| FileSearch | `fileSearch.ts` | 4KB | File searching |
| Logs | `logs.ts` | 13KB | Log management |

---

## ApprovalDecision

Handles user approval for tool executions in CLI.

**Features**:
- Interactive prompts
- Auto-approval rules
- Approval history

---

## Autocomplete

Provides intelligent autocompletion.

**Features**:
- Command completion
- File path completion
- Model name completion
- Context-aware suggestions

---

## CommandExecutor

Executes CLI commands.

**Features**:
- Command parsing
- Argument validation
- Output formatting

---

## Extension Service

Integrates CLI with VS Code extension.

**Features**:
- IPC communication
- State synchronization
- Shared configuration

---

## FileSearch

Searches files for CLI operations.

**Features**:
- Glob pattern matching
- Content search
- File filtering

---

## Logs Service

Manages CLI logging.

**Features**:
- Log levels
- File logging
- Log rotation

---

[← Back to CLI](../../Feature-Index.md)

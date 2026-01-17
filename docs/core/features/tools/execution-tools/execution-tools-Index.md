# Tools - Execution Tools

**Quick Navigation for AI Agents**

---

## Overview

Command execution tools. Enable AI to run shell commands and invoke slash commands.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| ExecuteCommandTool | Run shell commands | `ExecuteCommandTool.ts` | 13KB |
| RunSlashCommandTool | Execute slash commands | `RunSlashCommandTool.ts` | 4KB |

---

## ExecuteCommandTool

**Purpose**: Execute shell commands in terminal

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| command | string | Yes | Command to execute |
| cwd | string | No | Working directory |

**Behavior**:
1. Validates command safety
2. Creates/reuses terminal
3. Executes command
4. Captures output
5. Returns result

**Security**: Commands require user approval unless auto-approved.

---

## RunSlashCommandTool

**Purpose**: Execute Kilocode slash commands

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| command | string | Yes | Slash command name |
| args | string | No | Command arguments |

**Available Commands**: `/new`, `/clear`, `/mode`, etc.

---

## Related

- [Terminal Integration](../../../../integrations/features/terminal/) - Terminal management
- [Auto-Approval](../../auto-approval/) - Command approval rules

---

[← Back to Tools](../tools-Index.md)

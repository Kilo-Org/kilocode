# Services - Terminal Feature

**Quick Navigation for AI Agents**

---

## Overview

Terminal command execution service. Handles running shell commands and capturing output.

**Source Location**: `src/services/command/`

---

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| CommandService | Class | Command execution |

---

## Quick Reference

| Operation | Description |
|-----------|-------------|
| Execute command | Run shell command |
| Get output | Capture command output |
| Handle errors | Process command errors |

---

## How It Works

1. Receives command to execute
2. Spawns shell process
3. Streams output back
4. Returns exit code and result

---

## Related

- [Terminal Integration](../../../integrations/features/terminal/) - VS Code terminal
- [Execution Tools](../../../core/features/tools/execution-tools/) - ExecuteCommandTool

---

[← Back to Services](../../Feature-Index.md)

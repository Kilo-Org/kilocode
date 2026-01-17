# Integrations - Terminal Feature

**Quick Navigation for AI Agents**

---

## Overview

VS Code terminal integration. Manages terminal instances, process execution, and shell integration.

**Source Location**: `src/integrations/terminal/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| Terminal | Class | `Terminal.ts` | 7KB |
| BaseTerminal | Class | `BaseTerminal.ts` | 9KB |
| TerminalProcess | Class | `TerminalProcess.ts` | 15KB |
| ExecaTerminal | Class | `ExecaTerminal.ts` | - |
| TerminalRegistry | Class | `TerminalRegistry.ts` | 9KB |
| ShellIntegrationManager | Class | `ShellIntegrationManager.ts` | 4KB |

---

## TerminalRegistry

Manages all terminal instances.

**Key Methods**:
| Method | Purpose |
|--------|---------|
| `createTerminal()` | Create new terminal |
| `getTerminal()` | Get terminal by ID |
| `disposeTerminal()` | Close terminal |

---

## TerminalProcess

Handles command execution in terminal.

**Key Methods**:
| Method | Purpose |
|--------|---------|
| `run()` | Execute command |
| `sendInput()` | Send input to process |
| `getOutput()` | Get command output |
| `kill()` | Terminate process |

---

## ShellIntegrationManager

Integrates with VS Code shell integration API.

**Features**:
- Command detection
- Output capture
- Working directory tracking

---

## Terminal Types

| Type | Description |
|------|-------------|
| `Terminal` | VS Code integrated terminal |
| `ExecaTerminal` | Headless terminal (execa) |
| `BaseTerminal` | Abstract base class |

---

## Related

- [Execution Tools](../../../core/features/tools/execution-tools/) - ExecuteCommandTool
- [Terminal Service](../../../services/features/terminal/) - Command service

---

[← Back to Integrations](../../Feature-Index.md)

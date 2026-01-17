# CLI Module Features

**Quick Navigation for AI Agents**

---

## Overview

Standalone CLI application for Kilocode. Built with React + Ink for terminal UI. Supports 20 commands, authentication, and full feature parity with VS Code extension.

**Source Location**: `cli/src/`
**Binary Names**: `kilocode`, `kilo`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[commands](./features/commands/)** | 20 CLI commands | `commands/*.ts` |
| **[auth](./features/auth/)** | CLI authentication | `auth/index.ts`, `auth/providers/` |
| **[services](./features/services/)** | CLI services | `services/*.ts` |

---

## CLI Commands

| Command | Purpose | File |
|---------|---------|------|
| `help` | Help system | `help.ts` |
| `config` | Configuration | `config.ts` |
| `model` | Model selection (28KB) | `model.ts` |
| `provider` | Provider management | `provider.ts` |
| `session` | Session management (12KB) | `session.ts` |
| `tasks` | Task management (14KB) | `tasks.ts` |
| `checkpoint` | Checkpoint management (12KB) | `checkpoint.ts` |
| `new` | New task | `new.ts` |
| `clear` | Clear history | `clear.ts` |
| `condense` | Context condensation | `condense.ts` |
| `mode` | Mode switching | `mode.ts` |
| `profile` | Profile management | `profile.ts` |
| `teams` | Team/org management | `teams.ts` |
| `theme` | Theme selection | `theme.ts` |
| `exit` | Exit CLI | `exit.ts` |

---

## CLI Services

| Service | Purpose | File |
|---------|---------|------|
| `approvalDecision.ts` | Approval decisions (12KB) | Decision handling |
| `autocomplete.ts` | Autocompletion (21KB) | Input autocompletion |
| `commandExecutor.ts` | Command execution | Execute commands |
| `extension.ts` | Extension integration (14KB) | VS Code integration |
| `fileSearch.ts` | File searching | File search |
| `logs.ts` | Log management (13KB) | Logging |

---

## Architecture

```
cli/src/
├── cli.ts              → Main CLI (25KB)
├── index.ts            → Entry point (13KB)
├── commands/           → Command implementations
├── services/           → CLI services
├── auth/               → Authentication
├── ui/                 → Ink-based UI components
├── communication/      → IPC communication
├── config/             → CLI configuration
└── types/              → Type definitions
```

---

[← Back to Index](../Index.md)

# Integrations Module Features

**Quick Navigation for AI Agents**

---

## Overview

VS Code-specific integrations. Handles editor operations, terminal management, diagnostics, notifications, and authentication.

**Source Location**: `src/integrations/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[editor](./features/editor/)** | Diff view, decorations, editor utils (26KB) | `DiffViewProvider.ts`, `DecorationController.ts` |
| **[terminal](./features/terminal/)** | Terminal management (11 files) | `Terminal.ts`, `TerminalProcess.ts`, `TerminalRegistry.ts` |
| **[diagnostics](./features/diagnostics/)** | VS Code diagnostics display | `diagnostics/index.ts` |
| **[claude-code](./features/claude-code/)** | OAuth, streaming client | `oauth.ts`, `streaming-client.ts` |

---

## Other Integrations

| Integration | Purpose | Key File |
|-------------|---------|----------|
| `notifications/` | VS Code notifications | `index.ts` |
| `workspace/` | Workspace operations | `workspace/` |
| `theme/` | Theme management | `theme/` |
| `misc/` | Text extraction, images, line counting | `extract-text.ts`, `image-handler.ts` |

---

## Terminal Architecture

```
terminal/
├── Terminal.ts            → Main terminal class
├── BaseTerminal.ts        → Base terminal (9KB)
├── TerminalProcess.ts     → Process management (15KB)
├── ExecaTerminal.ts       → Execa-based terminal
├── TerminalRegistry.ts    → Terminal registry (9KB)
├── ShellIntegrationManager.ts → Shell integration
└── types.ts               → Terminal types
```

---

## Key Entry Points

| Purpose | File Path |
|---------|-----------|
| Diff view | `src/integrations/editor/DiffViewProvider.ts` |
| Terminal | `src/integrations/terminal/Terminal.ts` |
| OAuth | `src/integrations/claude-code/oauth.ts` |

---

[← Back to Index](../Index.md)

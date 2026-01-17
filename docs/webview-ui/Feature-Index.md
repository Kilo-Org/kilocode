# Webview UI Module Features

**Quick Navigation for AI Agents**

---

## Overview

React-based frontend for Kilocode. Contains 200+ components for chat interface, settings panels, and reusable UI components. Built with React 19, Vite, and Tailwind CSS.

**Source Location**: `webview-ui/src/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[chat](./features/chat/)** | Chat interface (70+ components) | `ChatView.tsx`, `ChatRow.tsx`, `ChatTextArea.tsx` |
| **[settings](./features/settings/)** | Settings panels (80+ components) | `SettingsView.tsx`, `providers/*.tsx` |
| **[ui-components](./features/ui-components/)** | Reusable UI library (shadcn-based) | `button.tsx`, `input.tsx`, `dialog.tsx` |

---

## Chat Components (Key Files)

| Component | Purpose |
|-----------|---------|
| `ChatView.tsx` | Main chat container |
| `ChatRow.tsx` | Individual message row |
| `ChatTextArea.tsx` | Input text area |
| `AutoApproveMenu.tsx` | Auto-approval controls |
| `CheckpointMenu.tsx` | Checkpoint controls |
| `ModeSelector.tsx` | Mode selection |
| `ContextWindowProgress.tsx` | Context usage display |
| `BrowserSessionRow.tsx` | Browser session display |
| `CodebaseSearchResult.tsx` | Search results |

---

## Settings Components (Key Files)

| Component | Purpose |
|-----------|---------|
| `SettingsView.tsx` | Main settings container |
| `ApiConfigSelector.tsx` | API configuration |
| `ModelSelector.tsx` | Model selection |
| `TemperatureControl.tsx` | Temperature slider |
| `providers/*.tsx` | 50+ provider-specific settings |

---

## UI Components (shadcn-based)

| Component | Purpose |
|-----------|---------|
| `button.tsx` | Buttons |
| `input.tsx` | Text inputs |
| `dialog.tsx` | Modal dialogs |
| `select.tsx` | Dropdowns |
| `tabs.tsx` | Tab control |
| `tooltip.tsx` | Tooltips |
| `progress.tsx` | Progress bars |

---

## Architecture

```
webview-ui/src/
├── App.tsx              → Main React app (17KB)
├── components/
│   ├── chat/            → Chat UI (70+ files)
│   ├── settings/        → Settings UI (80+ files)
│   ├── ui/              → Reusable components
│   ├── modes/           → Mode UI
│   ├── mcp/             → MCP UI
│   └── kilocode/        → Agent manager UI
├── context/             → React context providers
├── hooks/               → Custom React hooks
└── i18n/                → Translations
```

---

[← Back to Index](../Index.md)

---
title: "VS Code Extension"
description: "Using Kilo Code in Visual Studio Code"
---

# VS Code Extension

Kilo Code is available as two VS Code extensions: the **VSCode (Legacy)** extension and the current **VSCode** version built on the Kilo CLI core.

{% tabs %}
{% tab label="VSCode" %}

## Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Kilo Code"
4. Click the dropdown arrow next to **Install** and select **Install Pre-Release Version**

The extension bundles its own CLI binary and spawns `kilo serve` as a background process. All communication happens over HTTP + SSE.

## Key Features

Key features include:

- **SolidJS-based UI** — Rebuilt sidebar with a modern component architecture
- **[JSONC config files](/docs/getting-started/settings)** — Portable settings in `kilo.jsonc` instead of VS Code settings
- **[Granular permissions](/docs/getting-started/settings/auto-approving-actions)** — Per-tool permission rules with glob patterns
- **[Agents](/docs/code-with-ai/agents/using-agents)** — Customizable agents (`.kilo/agents/*.md`) replacing the modes system
- **[Agent Manager](/docs/automate/agent-manager)** — Enhanced with diff panel, multi-model comparison, PR import, and code review annotations
- **[Autocomplete](/docs/code-with-ai/features/autocomplete)** — FIM-based with Codestral, status bar cost tracking
- **[Workflows](/docs/customize/workflows)** — Repeatable prompt templates as `.md` files
- **[Skills](/docs/customize/skills)** — Load specialized domain knowledge from SKILL.md files
- **[Custom Subagents](/docs/customize/custom-subagents)** — Define specialized sub-agents for the `task` tool
- **Open in Tab** — Pop the chat out into a full editor tab
- **Sub-Agent Viewer** — Read-only panels for viewing child agent sessions
- **Legacy Migration** — Automatic migration wizard for VSCode extension settings

## Shared Settings

The extension shares its configuration with the CLI. Settings in `~/.config/kilo/kilo.jsonc` (global) and `./kilo.jsonc` (project) apply to both the CLI and the extension.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

## Installation

{% partial file="install-vscode.md" /%}

## Key Features

- **Sidebar chat** — AI-powered chat panel in the VS Code activity bar
- **[Autocomplete](/docs/code-with-ai/features/autocomplete)** — Inline code completions as you type
- **[Code Actions](/docs/code-with-ai/features/code-actions)** — Explain, fix, and improve code from the editor context menu
- **[Agents](/docs/code-with-ai/agents/using-agents)** — Code, Ask, Architect, Debug, Orchestrator, and Review modes
- **[Custom Modes](/docs/customize/custom-modes)** — Define custom modes with `.kilocodemodes` YAML files
- **[MCP](/docs/automate/mcp/overview)** — Connect to MCP servers for extended capabilities
- **[Agent Manager](/docs/automate/agent-manager)** — Multi-session orchestration with git worktree isolation
- **[Git Commit Generation](/docs/code-with-ai/features/git-commit-generation)** — AI-powered commit messages from the Source Control panel
- **[Context Mentions](/docs/code-with-ai/agents/context-mentions)** — Reference files, URLs, diagnostics, and git changes with `@`
- **[Checkpoints](/docs/code-with-ai/features/checkpoints)** — Git-based snapshots for undo/redo

{% /tab %}
{% /tabs %}

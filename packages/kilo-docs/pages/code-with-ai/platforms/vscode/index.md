---
title: "Kilo Code for VS Code: Free Open-Source AI Coding Extension"
description: "Using Kilo Code in Visual Studio Code"
---

# Kilo Code for VS Code

Kilo Code is available as two VS Code extensions: the **VSCode (Legacy)** extension and the current **VSCode** version built on Kilo's shared agent runtime.

{% tabs %}
{% tab label="VSCode" %}

## Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Kilo Code"
4. Click the dropdown arrow next to **Install** and select **Install Pre-Release Version**

The extension includes its own embedded runtime. No separate Kilo CLI installation is required.

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
- **Transcript export:** Save complete local session transcripts as Markdown files
- **Sub-Agent Viewer** — Read-only panels for viewing child agent sessions
- **Legacy Migration** — Automatic migration wizard for VSCode extension settings

## Shared Settings

Settings apply across extension surfaces, including the sidebar and Agent Manager. The standalone CLI uses the same `~/.config/kilo/kilo.jsonc` (global) and `./kilo.jsonc` (project) files when used directly.

## Proxy and Certificate Troubleshooting

Kilo Code for VS Code starts its embedded runtime from the extension and applies the relevant VS Code network settings to that runtime. On managed networks, configure proxy and certificate trust in VS Code settings rather than in a separate CLI install.

Use these settings when your organization requires a proxy or inspects HTTPS traffic:

- Set `http.proxy` to your organization proxy URL.
- Use `http.noProxy` for hosts that should bypass the proxy.
- Leave `http.proxySupport` enabled unless you intentionally want VS Code and Kilo Code to ignore proxy settings.
- Install your organization's root certificate authority in the operating system trust store when HTTPS inspection is in use.
- If the operating system trust store is not enough, set `kilo-code.new.extraCaCerts` to the absolute path of a PEM file that contains the additional certificate authority certificates.
- Keep `http.proxyStrictSSL` enabled whenever possible. Disable it only as a temporary troubleshooting step or when your administrator explicitly requires it, because it disables TLS certificate verification for this path.

Example user or workspace settings:

```json
{
  "http.proxy": "http://proxy.example.com:8080",
  "http.noProxy": ["localhost", "127.0.0.1", ".example.internal"],
  "kilo-code.new.extraCaCerts": "/absolute/path/to/corporate-ca.pem"
}
```

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

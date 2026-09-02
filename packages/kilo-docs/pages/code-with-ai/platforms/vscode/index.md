---
title: "Kilo Code for VS Code: Free Open-Source AI Coding Extension"
description: "Using Kilo Code in Visual Studio Code"
---

# Kilo Code for VS Code

The Kilo Code VS Code extension uses the shared Kilo agent runtime while integrating chat, agents, and automation into the editor.

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
- **Charts** — Ask for a chart or plot and get an inline data visualization in the chat
- **Open in Tab** — Pop the chat out into a full editor tab
- **Transcript export:** Save complete local session transcripts as Markdown files
- **Sub-Agent Viewer** — Read-only panels for viewing child agent sessions
- **Legacy Migration** — Automatic migration wizard for VSCode extension settings

## Background agents

When Kilo starts an agent in the background, a collapsible status strip appears in the chat header. The strip stays visible while the transcript scrolls, so you can check background work without searching the conversation. Click the strip to expand it and see each agent.

Each agent shows one of these states:

| State | Meaning |
|---|---|
| **Running** | The agent is still working. |
| **Done** | The agent completed successfully. |
| **Cancelled** | The agent was stopped before it completed. |
| **Error** | The agent stopped because it encountered an error. |

An agent can also show **Needs input** when it is waiting for a permission decision or an answer to a question. Open the agent row to inspect its read-only transcript and handle the request in the child-agent view. In the sidebar and Kilo tab, the transcript opens in a read-only editor tab. In Agent Manager, it opens in the right-hand inspector.

Use these controls in the expanded strip:

- **Stop** cancels a running agent and its child session.
- **Dismiss** hides one finished agent from the strip. It does not delete the transcript or the agent record.
- **Clear finished** hides all agents that are no longer running.
- **Continue in background** appears when a foreground subagent is running. It detaches that work so the parent session can continue while the subagent runs in the background.

While background agents are running, the strip also shows a **Stop all (N)** button that cancels every running background agent for the current session without stopping the main session.

Stopping the main session with `Esc` or the chat's **Stop** button ends the current response but keeps background agents running. Completed background results are retained and delivered when you send the next message or use **Continue**.

## Follow-up Messages

The prompt input stays editable while the agent is working. Send a message while a response is running to add it to the session's queue; queued messages are processed in order.

- **Edit a queued message** — click the edit icon on a queued message to remove it from the queue and restore its content, including pasted images and file references, to the prompt input. Edit is unavailable while the input already contains text, images, or review comments. Submitting the edited prompt queues it at the end as a new message; other queued messages keep their order.
- **Resume an interrupted response** — after you stop a response, the send button becomes **Continue** while the prompt input is empty. Click it to resume the original turn with the same model and agent, without adding a new user message. Continue is unavailable for completed responses and starts a new model request; it does not roll back tool side effects from the interrupted turn.

## Shared Settings

Settings apply across extension surfaces, including the sidebar and Agent Manager. The standalone CLI uses the same `~/.config/kilo/kilo.jsonc` (global) and `./kilo.jsonc` (project) files when used directly.

## Interface Language

The extension UI follows VS Code's display language by default. Override it with the `kilo-code.new.language` setting (for example `en`, `de`, `ja`, or `fa`). Right-to-left languages such as Arabic and Persian switch the layout direction automatically.

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

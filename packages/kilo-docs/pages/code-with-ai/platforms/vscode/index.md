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
- **[Notifications](/docs/getting-started/settings/notifications)** - Choose sounds, VS Code alerts, or OS notifications when a session needs attention
- **[Keep Awake](/docs/getting-started/settings/keep-awake)** - Optionally prevent system sleep while agents work in a local VS Code window
- **Transcript export:** Save complete local session transcripts as Markdown files
- **Sub-Agent Viewer** — Read-only panels for viewing child agent sessions
- **Legacy Migration** — Automatic migration wizard for VSCode extension settings

## Background agents

When Kilo starts agents in the background, the agent map button appears in the row above the prompt, next to the working indicator or the session actions. It shows how many background agents are still running, so you can check background work without searching the conversation. A dot on the button marks an agent that needs your input (amber) or new posts on the shared agent board (blue). Click the button to open the [agent map](#agent-map).

An agent needs input when it is waiting for a permission decision or an answer to a question. Open its transcript from the agent map to handle the request. In the sidebar and Kilo tab, the transcript opens in a read-only editor tab. In Agent Manager, it opens in the right-hand inspector.

Use these controls to manage background work:

- **Stop agent** in the agent map cancels a running agent and anything it started.
- **Stop all (N)** in the agent map cancels every running agent the session started, without stopping the main session.
- **Hide finished** in the agent map shows only the agents that are still running.
- **Continue in background** appears on a running foreground subagent's task card. It detaches that work so the parent session can continue while the subagent runs in the background.

Stopping the main session with **Stop** or `Esc` ends its current response but leaves background agents running. Use **Stop all (N)** or an agent's **Stop agent** to cancel background work. Completed background results are available when you send the next message or use **Continue**.

## Agent map

The agent map shows the current session and everything it started, directly or through another agent: subagents, Agent Manager sessions, and the background processes they run. Open it with **Show agent map** in the chat header, or with the agent map button above the prompt. The header button appears once the session has started a subagent, an Agent Manager session, or a background process. Opened from a subagent's view, the map starts at that subagent.

The session sits on the left and each generation fans out to the right. In a narrow panel, such as the sidebar, the map stacks vertically. Each agent carries the same avatar as its task card in the conversation, and each node shows its agent, run time, and token count. A filled dot means the node is running (green), waiting for your input (amber), or failed (red). A hollow dot means it finished, and a dashed one that it was stopped. Turn on **Hide finished** to show only the work that is still running, along with the agents that started it. The map refreshes while it is open.

| Node | What it is |
|---|---|
| **Main agent** | The session you opened the map from. |
| **Subagent** | An agent started with the Task tool, in the foreground or the background. |
| **Agent Manager session** | A session started by the `agent_manager` tool, for example in a new worktree. |
| **Background process** | A long-running command, such as a dev server, started by the background process tool. |

Select a node to see who started it, how long it ran, its tokens and cost, and the prompt it received. **Open transcript** opens the agent's conversation, and **Stop agent** or **Stop process** cancels it together with anything it started.

When the session has a shared agent board, the dialog has a **Board** tab next to the **Map** tab, where agents post their questions and results. A dot on the tab marks unread posts. **Refresh** reloads the board, and **Reset board** clears every post after you confirm. **Board posts (N)** on a node opens the tab filtered to the posts that agent sent or received. Selecting a sender in a post opens that agent on the map.

When you revert a turn, the agents and processes that turn started leave the map once they have stopped. Anything from that turn that is still running stays, so you can stop it. Reverting does not remove board posts: use **Reset board** to clear posts from reverted work.

Agent Manager sessions started by earlier versions of Kilo do not record which session started them, so they do not appear in the map.

## Follow-up messages

Send a message while Kilo is working to queue it for processing in order. To revise a queued message, clear the prompt input and click the message's edit icon. This removes it from the queue and restores its text, images, and file references to the input. Sending it again adds it to the end of the queue.

After stopping a response, leave the input empty and click **Continue** to resume the interrupted turn with its original model and agent, without adding another user message. Continue starts a new model request; it does not undo tool actions already performed and is not available for completed responses.

## Multi-root workspaces

Kilo chat uses only the first folder in your VS Code workspace. When a window has more than one folder, the empty chat shows a dismissible hint naming the folder that chat uses, so a multi-root Explorer does not suggest the other folders are in scope. Dismissing the hint is remembered until the first folder changes. To work in a different folder, open it in its own VS Code window or add it as a project in [Agent Manager](/docs/automate/agent-manager-projects). Explicit project hosts, including Agent Manager, do not show the hint.

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

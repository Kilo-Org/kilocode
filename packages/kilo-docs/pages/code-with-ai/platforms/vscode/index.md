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
- **Prompt navigator** — Jump between prompts in long sessions from a rail beside the transcript
- **[Documents tab](/docs/code-with-ai/agents/chat-interface)** — Markdown references open in a rendered, interactive document tab with image previews, copy actions, and line comments
- **[Notifications](/docs/getting-started/settings/notifications)** - Choose sounds, VS Code alerts, or OS notifications when a session needs attention
- **[Keep Awake](/docs/getting-started/settings/keep-awake)** - Optionally prevent system sleep while agents work in a local VS Code window
- **Transcript export:** Save complete local session transcripts as Markdown files
- **Sub-Agent Viewer** — Read-only panels for viewing child agent sessions
- **Legacy Migration** — Automatic migration wizard for VSCode extension settings

## Background agents

When Kilo starts an agent in the background, the agent stack appears in the session dock above the prompt, next to the working indicator or the idle actions. It stays visible while the transcript scrolls, so you can check background work without searching the conversation. The stack shows the agents started in the current run, with running agents first and finished agents dimmed below them. Select the agent avatars to open a panel with each agent and its controls.

Each agent shows one of these states:

| State | Meaning |
|---|---|
| **Running** | The agent is still working. |
| **Done** | The agent completed successfully. |
| **Cancelled** | The agent was stopped before it completed. |
| **Error** | The agent stopped because it encountered an error. |

An agent can also show **Needs input** when it is waiting for a permission decision or an answer to a question. Open the agent row to inspect its read-only transcript and handle the request in the child-agent view. In the sidebar and Kilo tab, the transcript opens in a read-only editor tab. In Agent Manager, it opens in the right-hand inspector.

Use these controls in the agent panel:

- **Open** an agent row to view its transcript. **Open all background agents** opens every agent in the stack at once.
- **Stop** cancels a running agent and its child session.
- **Stop all (N)** cancels every running background agent for the current session without stopping the main session.
- **Clear finished** hides agents that are no longer running. It does not delete their transcripts or agent records.

**Continue in background** appears on a running foreground subagent's task card. It promotes that work so the parent session can continue while the subagent runs in the background.

Stopping the main session with **Stop** or `Esc` ends its current response but leaves background agents running. Use **Stop all (N)** or an individual agent's **Stop** to cancel background work. Completed background results are available when you send the next message or use **Continue**.

## Follow-up messages

Send a message while Kilo is working to queue it for processing in order. To revise a queued message, clear the prompt input and click the message's edit icon. This removes it from the queue and restores its text, images, and file references to the input. Sending it again adds it to the end of the queue.

After stopping a response, leave the input empty and click **Continue** to resume the interrupted turn with its original model and agent, without adding another user message. Continue starts a new model request; it does not undo tool actions already performed and is not available for completed responses.

## Prompt navigator

When a session has two or more prompts, a prompt navigator appears along the transcript edge as a hairline tick per prompt. Hover a tick to open a card of prompt and answer previews, then select a row to jump to that prompt. The card header jumps to the first or latest prompt.

You can also use the keyboard: `ArrowUp` and `ArrowDown` move between ticks, `Home` and `End` move to the first or latest tick, and `Enter` or `Space` opens the focused entry. `Esc` closes the card before other chat shortcuts see it.

The first tick loads earlier history progressively when it has not been loaded yet and shows a loading row while it runs. In long sessions, older prompts collapse into a dashed overflow tick. Queued prompts carry a **Queued** marker until they are delivered, and the scroll wheel over the rail scrolls the transcript. The rail follows your sidebar location, so it stays on the physical right in Agent Manager and editor tabs.

## Reviewing changes

The **Changes** button above the prompt shows the working tree totals (`+N -M`) when files have changed and opens the **Changes** editor tab. The tab opens on the **Branch** diff, which compares your branch with its base branch and includes staged, unstaged, untracked, and local commit changes. Use the source picker to switch to **Staged**, **Unstaged**, or **Session**; the **Session** scope collects the files Kilo changed during the current session.

Each completed turn that changed files shows a **Modified N files** row with addition and deletion bars. Select the row to open the diff for that turn only.

In the diff viewer:

- Use the layout toggle to switch between unified and split view. Kilo remembers your choice in the `kilo-code.new.diff.style` setting.
- For Markdown files, use the eye/code toggle to switch between rendered Markdown and the raw diff. See [Markdown Diff Rendering](/docs/getting-started/settings#markdown-diff-rendering).
- Add an inline comment on a changed line and choose **Send to Kilo**. The comment appears as a card above the prompt and is included when you send your next message.

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

---
title: Tool Use Details
description: Learn how Kilo Code's tools automate your development workflow
---

# Tool Use Overview

Kilo Code implements a sophisticated tool system that allows AI models to interact with your development environment in a controlled and secure manner. This document explains how tools work, when they're called, and how they're managed.

## Core Concepts

### Tool Groups

Tools are organized into logical groups based on their functionality:

| Category | Purpose | Tools | Common Use |
|---|---|---|---|
| **Read Group** | File system reading and searching | `read`, `glob`, `grep` | Code exploration and analysis |
| **Edit Group** | File system modifications | `edit`, `write`, `apply_patch` | Code changes and file manipulation |
| **Execute Group** | Shell command execution | `bash` | Running scripts, building projects |
| **Web Group** | Fetch and search web content | `webfetch`, `websearch` | Research, documentation lookup |
| **Browser Preview** | Agent Manager's built-in browser preview | `browser_open` | Previewing and checking locally running apps and public HTTPS pages |
| **MCP Group** | External tool integration | MCP server tools (namespaced as `{server}_{tool}`) | Specialized functionality via MCP |
| **Workflow Group** | Sub-agents and task management | `question`, `task`, `todowrite`, `todoread`, `plan`, `skill`, `agent_manager`, `board_post`, `board_read` | Context switching and task organization |

### Always Available Tools

Certain tools are accessible regardless of the current agent:

- `question`: Ask the user a clarifying question with selectable options
- `task`: Spawn a sub-agent session
- `todowrite` / `todoread`: Manage session task lists

## Available Tools

### Read Tools

These tools help Kilo Code understand your code and project:

- `read` - Reads file contents with line numbers
- `glob` - Finds files matching a glob pattern
- `grep` - Searches file contents with regex

### Edit Tools

These tools help Kilo Code make changes to your code:

- `edit` - Makes precise text replacements in a file
- `write` - Creates new files or fully overwrites existing ones
- `apply_patch` - Applies unified diffs (used with certain models)

For multiple replacements in one file, Kilo uses repeated `edit` calls or a patch-style edit when the model supports it.

### Execute Tools

These tools help Kilo Code run commands:

- `bash` - Runs shell commands with configurable timeout and working directory

{% callout type="info" %}
The `interactive_terminal` tool and the in-session terminal controls were removed, along with their API endpoints and SDK types. Run commands that need keyboard input in your own terminal, and use the `bash` tool for non-interactive shell commands. See [Shell Integration](/docs/automate/extending/shell-integration) for details.
{% /callout %}

### Web Tools

These tools help Kilo Code access web content:

- `webfetch` - Fetches a URL and returns the content
- `websearch` - Searches the web

#### Web Search Availability

`websearch` is available automatically with the Kilo provider. For models from other providers it is off by default; enable it for all providers by setting `web_search` in `kilo.jsonc`:

```json
{
  "web_search": true
}
```

In the VS Code extension, the same option lives under **Settings → Web Tools → Web Search → Enable for All Providers**. The `KILO_ENABLE_EXA` and `KILO_ENABLE_PARALLEL` environment flags also enable it.

#### Web Search Providers

`websearch` routes through the Exa or Parallel search providers. When the Exa provider is used and you are signed into Kilo, requests go through the Kilo proxy automatically — no separate Exa API key is required. Setting `EXA_API_KEY` uses your own Exa key instead. Exa searches return at most 10 results.

Set the `KILO_WEBSEARCH_PROVIDER` environment variable to force a provider:

| Value | Behavior |
|---|---|
| `exa` | Use Exa — through the Kilo proxy when signed in, through `EXA_API_KEY` when set |
| `parallel` | Use Parallel |
| `kilo-exa` | Always route Exa searches through the Kilo proxy (requires Kilo sign-in) |

### Browser Tools

The VS Code extension has a built-in browser automation tool powered by [Playwright MCP](https://www.npmjs.com/package/@playwright/mcp). Enable it in **Settings → Web Tools → Browser Automation**. When enabled, it registers an MCP server named `kilo-playwright` and exposes browser tools that follow the same permission model as all MCP tools.

The VS Code extension's experimental `browser_open` tool opens a local application in Agent Manager's Integrated Browser panel and returns a screenshot and diagnostics. Enable **Integrated Browser** under **Settings > Experimental**. It requires installed Chrome or compatible Playwright Chromium. It is independent from Playwright MCP.

The `browser_open` automation browser accepts HTTP URLs on `localhost` or `127.0.0.1` and public HTTPS URLs. Public HTTPS and WSS resources, such as public CDN modules, can load across origins, but navigating to a new document origin requires your approval. See [Browser previews](/docs/automate/agent-manager#browser-previews) for setup and element feedback.

Access is scoped to `browser_open` and is separate from Kilo's web access in general. Use `websearch` and `webfetch` to find and read public web pages. Browser tools from a separately configured MCP server can provide interactive web browsing according to that server's capabilities and permissions.

### MCP Tools

MCP server tools are automatically available when an MCP server is connected. Tool names are namespaced as `{server}_{tool}`. See [MCP Overview](/docs/automate/mcp/overview) for details.

### Workflow Tools

These tools help manage the conversation and task flow:

- `question` - Asks you a clarifying question with selectable options
- `task` - Spawns a sub-agent (child session)
- `todowrite` - Creates and updates a session TODO list
- `todoread` - Reads the current session TODO list
- `plan` - Enters structured planning mode
- `skill` - Invokes a reusable skill (Markdown instruction module)
- `open_plan` - Opens a saved plan for review in the VS Code extension
- `agent_manager` - Starts Agent Manager local or worktree sessions in VS Code
- `board_post` / `board_read` - Exchange messages on the Kilo Swarm board
- `background_process` - Starts long-running processes and monitors their output
- `link_pr` - Links the session to a pull request by URL
- `schedule_wakeup` / `cancel_wakeup` - Schedule or cancel a one-shot wakeup for the session
- `cron_create` / `cron_list` / `cron_delete` - Schedule recurring or one-shot tasks for the session

### Task tool

Full-tool primary agents can use `task` to delegate a focused subtask without switching to the deprecated `orchestrator` agent. A task child runs in a separate session and transcript, but it uses the same project directory or worktree as its parent. `task` does not create a git worktree.

Task children are non-interactive delegates. They cannot ask the end user a question directly, but they can use the tools allowed by their agent and session permissions. Their result is returned to the parent session, and the child transcript can be inspected from its task card in VS Code.

There are two execution modes:

| Mode | Behavior | Use it when |
|---|---|---|
| Foreground (default) | The parent waits for the child and receives its result before continuing. | Later work depends on the child output. |
| Background (`background: true`) | The tool returns immediately. Kilo delivers a completion or error result to the parent session when the child finishes. | The work is independent and can run while the parent continues. |

For example, a primary agent can start independent background research with a call shaped like this:

```json
{
  "description": "Audit API routes",
  "prompt": "Inspect the API routes and report authentication risks. Do not edit files.",
  "subagent_type": "explore",
  "background": true
}
```

Background subagents are available when the server exposes the background capability. Do not poll for progress or duplicate work in the same files. If Kilo returns a `task_id` after a failed or interrupted child, use it to resume that child when the current session and permissions allow it. A child can create more task children only when its configured depth and `task` permission allow it.

### Kilo Swarm board tools

Kilo Swarm is a shared board for one main session and its `task` descendants, including nested descendants. It is on by default; turn it off in **Settings > Agent Behaviour** or set `shared_agent_board` to `false` in `kilo.jsonc`. The board is not shared by unrelated sessions, even when they use the same repository or worktree.

- `board_post` stores a concise material update for another participant. Use it for findings, questions, results, blockers, or corrections.
- `board_read` reads board messages explicitly. Use the cursor from the previous read for incremental reads instead of polling.
- Board activity notices are best-effort and do not prove that a recipient read or acted on a message.
- Board messages are coordination data, not user approval. Posting does not start, wake, assign, resume, stop, or cancel an agent.

See [Kilo Swarm communication](/docs/automate/agent-manager#kilo-swarm-communication) for how the board relates to background agents and Agent Manager sessions.

### Agent Manager tool

The `agent_manager` tool is available in the VS Code extension. It creates visible Agent Manager sessions in either isolated `worktree` mode or shared `local` mode, and it can inspect and control existing sessions. Use it when you need separate branches, separate terminals, or multiple independent conversations. Use `task` when a child should remain part of the current session's task tree.

For existing sessions, call `action: "list"` to discover exact session, worktree, and section IDs before using `prompt`, `stop`, `move`, or `answer`. A targeted prompt is queued for a busy session and returns when accepted; it does not wait for the session to finish or broadcast to other sessions. See [Starting and orchestrating sessions from chat](/docs/automate/agent-manager#starting-and-orchestrating-sessions-from-chat) for the full workflow.

### Background process tool

Use `background_process` for long-running commands that must survive the turn, such as development servers, file watchers, local services, and test watchers (`npm run dev`, `next dev`, `vite`, or `bun --watch`). It replaces shell backgrounding patterns (`&`, `nohup`, `disown`, `setsid`) so Kilo can track each process and show it in the CLI sidebar.

| Action | Behavior |
|---|---|
| `start` | Starts a process and returns immediately. The process keeps running after the turn. |
| `monitor` | Runs a command and returns its output as it arrives, so a waiting agent reads progress instead of polling. |
| `list` | Lists the session's background processes. |
| `status` | Inspects one process by id. |
| `logs` | Returns the retained tail output for one process. |
| `stop` | Terminates a process and its child process tree. |
| `restart` | Stops and restarts a process with its original command and lifetime. |

Prefer `monitor` over `start` plus repeated `logs` when you need the output of a command that finishes on its own, such as a build, a test run, or a deploy. `monitor` stops when the process exits, and also stops at a line cap (default 200 lines, range 1–1000) or a wall-time cap (default 120000 ms, range 5000–600000). Reaching either cap does not stop the process: it keeps running as a normal background process, and the result names its `id` so the agent can follow up with `logs`, `status`, or `stop`.

`start` accepts one lifetime option:

| Option | Effect |
|---|---|
| default | The process stops when its session ends, when the user switches session groups, or when Kilo exits. |
| `inherit: true` | Transfers the process to the immediate parent session when a sub-agent ends, then follows that session's lifetime. |
| `persistent: true` | The process survives session closure and Kilo shutdown and is visible and manageable from every session. |

`inherit` and `persistent` cannot be combined. Starting or restarting a background process is unavailable while [sandboxing](/docs/getting-started/settings/sandboxing) is active.

In a [session goal](/docs/code-with-ai/agents/goals), `monitor` blocks the goal turn until the process stops, and a non-terminal `start` suspends the goal until the process exits; the exit resumes the goal. Use one of these when the goal is to wait for a deploy, build, or CI job instead of polling with a shell command, which counts as goal progress and keeps the loop spinning.

### Scheduled wakeups

The `schedule_wakeup` tool defers the session's own continuation to a single future point, and `cancel_wakeup` lists or cancels those wakeups. Use a wakeup for a one-off wait such as a build, deploy, or CI window that finishes outside a blocking command.

| Tool | Behavior |
|---|---|
| `schedule_wakeup` | Resumes the session with the prompt you give it at exactly one future time. |
| `cancel_wakeup` | Lists the session's wakeups, or cancels one by id. Cancelling an id that is already gone is safe. |

`schedule_wakeup` accepts exactly one of:

- `when` — an absolute ISO-8601 date-time, for example `2026-09-13T14:30:00Z`. With an explicit offset (`Z` or `+02:00`) it is absolute; without one, the host's local timezone applies.
- `delay` — a relative span, for example `30s`, `5m`, `2h`, or `1d`. A bare number is seconds, and a delay under 10 seconds is raised to 10.

Limits and behavior:

- A session may hold at most 10 pending wakeups. Cancel one with `cancel_wakeup` before scheduling another when the cap is reached.
- A time more than seven days out is pulled back to the seven-day horizon, and the tool result says the requested time was clamped. A time at or before now is rejected.
- In a [session goal](/docs/code-with-ai/agents/goals), scheduling a wakeup suspends the goal until it fires and the goal reads as waiting. A one-shot time-based wait is normal goal progress, not a blocker. Cancelling the awaited wakeup resumes the goal with a goal turn, or settles it with a reason you can read.

### Scheduled session tasks

The agent can schedule work for the current session with the cron tools. A due task resumes the session between turns after it goes idle, so the agent does not have to stay in a blocking wait.

| Tool | Behavior |
|---|---|
| `cron_create` | Schedules a recurring or one-shot task from a prompt and exactly one schedule form; the tool assigns the task id. |
| `cron_list` | Lists each task's id, schedule, next fire time, and prompt. |
| `cron_delete` | Cancels a task by id. Deleting an id that is already gone is safe. |

`cron_create` accepts exactly one of:

- `cron` — a recurring 5-field expression, `minute hour day-of-month month day-of-week`, for example `*/5 * * * *` (every five minutes) or `0 9 * * 1-5` (weekdays at 09:00). Cron is minute-granular, so the smallest interval it can express is one minute.
- `when` — a one-shot absolute ISO-8601 date-time, for example `2026-09-13T14:30:00Z`. With no offset, the host's local timezone applies.
- `delay` — a one-shot relative span, for example `30s`, `5m`, `2h`, or `1d`. A bare number is seconds, and a delay under 10 seconds is raised to 10.

Limits and behavior:

- A session may hold at most 10 scheduled tasks.
- Each task expires seven days after it is created. A recurring schedule whose next fire would fall past that expiry is rejected; a one-shot `when` or `delay` beyond seven days is clamped to it.
- Missed fires are not replayed one-for-one. The next fire is computed from the current time, and fire times carry a small deterministic jitter so many sessions do not fire at once.
- Tasks survive `--resume`.
- In a [session goal](/docs/code-with-ai/agents/goals), creating a task suspends the goal until it fires, including every later fire of a recurring task. Deleting the awaited task resumes the goal with a goal turn, or settles it with a reason you can read.

### Linking a session to a pull request

The `link_pr` tool links the current session to a pull request or merge request. The agent calls it with the full URL after it opens one for the worktree, or when you give it a URL. It accepts GitHub pull requests, GitLab merge requests, and Bitbucket pull requests that belong to the worktree's own repository; a URL for another host or project is rejected. Linking does not create a pull request.

An explicit link always wins over a link Kilo detects from the session, and it is kept through later checks. Kilo also checks the worktree's own git host every five minutes for an open pull request on the current branch, so a session on a branch that already has an open pull request shows it without a tool call. When the host no longer reports the linked pull request open, Kilo clears the link and the session row updates.

The periodic check never runs per request. To refresh on demand, run `kilo pr status`. When the session has no explicit link, it queries the host before falling back to the recorded link. See the [CLI Command Reference](/docs/code-with-ai/platforms/cli-reference#kilo-pr) for `kilo pr link`, `kilo pr unlink`, and `kilo pr status`.

## Tool Calling Mechanism

### When Tools Are Called

Tools are invoked under specific conditions:

1. **Direct Task Requirements**
   - When specific actions are needed to complete a task as decided by the LLM
   - In response to user requests
   - During automated workflows

2. **Mode-Based Availability**
   - Different modes enable different tool sets
   - Mode switches can trigger tool availability changes
   - Some tools are restricted to specific modes

3. **Context-Dependent Calls**
   - Based on the current state of the workspace
   - In response to system events
   - During error handling and recovery

### Decision Process

The system uses a multi-step process to determine tool availability:

1. **Mode Validation**

   ```typescript
   isToolAllowedForMode(
       tool: string,
       modeSlug: string,
       customModes: ModeConfig[],
       toolRequirements?: Record<string, boolean>,
       toolParams?: Record<string, any>
   )
   ```

2. **Requirement Checking**
   - System capability verification
   - Resource availability
   - Permission validation

3. **Parameter Validation**
   - Required parameter presence
   - Parameter type checking
   - Value validation

## Technical Implementation

### Tool Call Processing

1. **Initialization**
   - Tool name and parameters are validated
   - Mode compatibility is checked
   - Requirements are verified

2. **Execution**

   ```typescript
   const toolCall = {
     type: "tool_call",
     name: chunk.name,
     arguments: chunk.input,
     callId: chunk.callId,
   }
   ```

3. **Result Handling**
   - Success/failure determination
   - Result formatting
   - Error handling

### Security and Permissions

1. **Access Control**
   - File system restrictions
   - Command execution limitations
   - Network access controls

2. **Validation Layers**
   - Tool-specific validation
   - Mode-based restrictions
   - System-level checks

## Mode Integration

### Mode-Based Tool Access

Tools are made available based on the current mode:

- **Code Mode**: Full access to file system tools, code editing capabilities, command execution
- **Ask Mode**: Limited to reading tools, information gathering capabilities, no file system modifications
- **Architect Mode**: Design-focused tools, documentation capabilities, limited execution rights
- **Custom Modes**: Can be configured with specific tool access for specialized workflows

### Mode Switching

1. **Process**
   - Current mode state preservation
   - Tool availability updates
   - Context switching

2. **Impact on Tools**
   - Tool set changes
   - Permission adjustments
   - Context preservation

## Best Practices

### Tool Usage Guidelines

1. **Efficiency**
   - Use the most specific tool for the task
   - Avoid redundant tool calls
   - Batch operations when possible

2. **Security**
   - Validate inputs before tool calls
   - Use minimum required permissions
   - Follow security best practices

3. **Error Handling**
   - Implement proper error checking
   - Provide meaningful error messages
   - Handle failures gracefully

### Common Patterns

1. **Information Gathering**

   ```
   `question` → `read` → `grep`
   ```

2. **Code Modification**

   ```
   `read` → `edit` → final response
   ```

3. **Task Management**

   ```
   `task` → `bash` → final response
   ```

4. **Progress Tracking**
   ```
   `todowrite` → `bash` → `todowrite`
   ```

## Error Handling and Recovery

### Error Types

1. **Tool-Specific Errors**
   - Parameter validation failures
   - Execution errors
   - Resource access issues

2. **System Errors**
   - Permission denied
   - Resource unavailable
   - Network failures

3. **Context Errors**
   - Invalid mode for tool
   - Missing requirements
   - State inconsistencies

### Recovery Strategies

1. **Automatic Recovery**
   - Retry mechanisms
   - Fallback options
   - State restoration

2. **User Intervention**
   - Error notifications
   - Recovery suggestions
   - Manual intervention options

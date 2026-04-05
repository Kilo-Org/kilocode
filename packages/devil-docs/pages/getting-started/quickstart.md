---
title: "Quickstart"
description: "Get up and running with Kilo Code in minutes"
---

# Quickstart

After you [set up Kilo Code](/docs/getting-started/setup-authentication), follow the guide for your platform below.

{% tabs %}
{% tab label="VSCode" %}

## Step by Step Guide

### Step 1: Open Kilo Code

Click the Kilo Code icon in the VS Code Primary Side Bar to open the chat panel. If you don't see the icon, verify the [extension is installed](/docs/getting-started/installing).

### Step 2: Type Your Task

Type a clear, concise description of what you want Kilo Code to do in the chat box. The same examples work here:

- "Create a file named `hello.txt` containing 'Hello, world!'."
- "Write a Python function that adds two numbers."
- "Create an HTML file for a simple website with the title 'Kilo test'"

No special commands or syntax needed—just use plain English.

### Step 3: Send Your Task

Press **Enter** to send.

### Step 4: Review & Approve Actions

Kilo Code analyzes your request and proposes actions. By default, most tools are auto-approved — only shell commands, external directory access, and sensitive file reads will prompt for confirmation. You'll see the tool name, arguments, and can approve or reject each action.

To change which actions require approval, open **Settings** (gear icon) and go to the **Auto-Approve** tab. You can set each tool to Allow, Ask, or Deny. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for details.

### Step 5: Iterate

Kilo Code works iteratively. Continue giving feedback or follow-up instructions until your task is complete.

### Key Differences from Legacy

- **Settings** are managed via `kilo.jsonc` config files (the Settings webview reads and writes the same files)
- **Permissions** use a granular per-tool system instead of broad approval categories
- **Modes** are called "agents" and configured as `.md` files or via the `agent` config key
- **Autocomplete** uses FIM (Fill-in-the-Middle) with Codestral

{% /tab %}
{% tab label="CLI" %}

## CLI Quickstart

### Step 1: Open a Terminal

Navigate to your project directory:

```bash
cd /path/to/your/project
```

### Step 2: Launch Kilo

Run the `kilo` command to start the interactive TUI (terminal user interface):

```bash
kilo
```

If this is your first time, run `kilo auth login` first to authenticate (see [Setup & Authentication](/docs/getting-started/setup-authentication)).

### Step 3: Type Your Task

Type your request in natural language at the prompt. The same examples work here:

- "Create a file named `hello.txt` containing 'Hello, world!'."
- "Write a Python function that adds two numbers."
- "Create an HTML file for a simple website with the title 'Kilo test'"

Press **Enter** to send.

### Step 4: Review & Approve Actions

Kilo analyzes your request and proposes actions. By default, most tools are auto-approved — only shell commands, external directory access, and sensitive file reads will prompt for confirmation. You'll see the tool name, arguments, and can approve or reject each action.

To change permission defaults, configure the `permission` key in your `kilo.jsonc` config file. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for details.

### Step 5: Iterate

Kilo works iteratively. Continue giving feedback or follow-up instructions until your task is complete.

### One-Shot Mode

For quick, non-interactive tasks, use `kilo run`:

```bash
kilo run "add error handling to src/api.ts"
```

Add `--auto` to auto-approve all permissions (use carefully):

```bash
kilo run --auto "fix the failing tests in test/auth.test.ts"
```

{% /tab %}
{% tab label="VSCode (Legacy)" %}

## Video Tour

{% youtube url="https://www.youtube.com/watch?v=pO7zRLQS-p0" caption="This quick tour shows how Kilo Code handles a simple request from start to finish" /%}

## Step by Step Guide

### Step 1: Open Kilo Code

Click the Kilo Code icon ({% kiloCodeIcon /%}) in the VS Code Primary Side Bar (vertical bar on the side of the window) to open the chat interface. If you don't see the icon, verify the extension is [installed](/docs/getting-started/installing) and enabled.

{% image src="/docs/img/your-first-task/your-first-task.png" alt="Kilo Code icon in VS Code Primary Side Bar" width="800" caption="The Kilo Code icon in the Primary Side Bar opens the chat interface." /%}

### Step 2: Type Your Task

Type a clear, concise description of what you want Kilo Code to do in the chat box at the bottom of the panel. Examples of effective tasks:

- "Create a file named `hello.txt` containing 'Hello, world!'."
- "Write a Python function that adds two numbers."
- "Create an HTML file for a simple website with the title 'Kilo test'"

No special commands or syntax needed—just use plain English.

{% callout type="tip" title="Optional: Try Autocomplete" collapsed=true %}
While chat is great for complex tasks, Kilo Code also offers **inline autocomplete** for quick code suggestions. Open any code file, start typing, and watch for ghost text suggestions. Press `Tab` to accept. [Learn more about Autocomplete →](/docs/code-with-ai/features/autocomplete)
{% /callout %}

{% image src="/docs/img/your-first-task/your-first-task-6.png" alt="Typing a task in the Kilo Code chat interface" width="500" caption="Enter your task in natural language - no special syntax required." /%}

### Step 3: Send Your Task

Press Enter or click the Send icon ({% codicon name="send" /%}) to the right of the input box.

### Step 4: Review & Approve Actions

Kilo Code analyzes your request and proposes specific actions. These may include:

- **Reading files:** Shows file contents it needs to access
- **Writing to files:** Displays a diff with proposed changes (added lines in green, removed in red)
- **Executing commands:** Shows the exact command to run in your terminal
- **Using the Browser:** Outlines browser actions (click, type, etc.)
- **Asking questions:** Requests clarification when needed to proceed

{% image src="/docs/img/your-first-task/your-first-task-7.png" alt="Reviewing a proposed file creation action" width="400" caption="Kilo Code shows exactly what action it wants to perform and waits for your approval." /%}

- In **Code** mode, writing capabilities are on by default.
- In **Architect** and **Ask** modes, Kilo Code won't write code.

{% callout type="tip" %}
The level of autonomy is configurable, allowing you to make the agent more or less autonomous.

You can learn more about [using agents](/docs/code-with-ai/agents/using-agents) and [auto-approving actions](/docs/getting-started/settings/auto-approving-actions).
{% /callout %}

### Step 5: Iterate

Kilo Code works iteratively. After each action, it waits for your feedback before proposing the next step. Continue this review-approve cycle until your task is complete.

{% image src="/docs/img/your-first-task/your-first-task-8.png" alt="Final result of a completed task showing the iteration process" width="500" caption="After completing the task, Kilo Code shows the final result and awaits your next instruction." /%}

{% /tab %}
{% /tabs %}

## Conclusion

You've completed your first task. Along the way you learned:

- How to interact with Kilo Code using natural language
- Why approval keeps you in control
- How iteration lets the AI refine its work

Ready for more? Here are some next steps:

- **[Autocomplete](/docs/code-with-ai/features/autocomplete)** — Get inline code suggestions as you type
- **[Agents](/docs/code-with-ai/agents/using-agents)** — Explore different agents for different tasks
- **[Git commit generation](/docs/code-with-ai/features/git-commit-generation)** — Automatically generate commit messages

{% callout type="tip" %}
**Accelerate development:** Check out multiple copies of your repository and run Kilo Code on all of them in parallel (using git to resolve any conflicts, same as with human devs). This can dramatically speed up development on large projects.
{% /callout %}

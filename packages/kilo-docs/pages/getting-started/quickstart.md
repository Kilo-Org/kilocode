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

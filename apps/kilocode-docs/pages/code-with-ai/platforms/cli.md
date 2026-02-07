---
title: "Kilo CLI"
description: "Using Kilo Code from the command line"
---

{% callout type="warning" title="Version Notice" %}
This documentation applies only to Kilo version 1.0 and later. Users running versions below 1.0 should upgrade before proceeding.
{% /callout %}

# Kilo CLI

Orchestrate agents from your terminal. Plan, debug, and code fast with keyboard-first navigation on the command line.

The Kilo Code CLI uses the same underlying technology that powers the IDE extensions, so you can expect the same workflow to handle agentic coding tasks from start to finish.

## Getting Started

### Install

{% partial file="install-cli.md" /%}

Change directory to where you want to work and run kilo:

```bash
# Start the TUI
kilo

# Check the version
kilo --version

# Get help
kilo --help
```

### First-Time Setup with `/connect`

After installation, run `kilo` and use the `/connect` command to add your first provider credentials. This is the interactive way to configure API keys for model providers.

## Update

Upgrade the Kilo CLI:

`kilo upgrade`

Or use npm:

`npm update -g @kilocode/cli`

## What you can do with Kilo Code CLI

- **Plan and execute code changes without leaving your terminal.** Use your command line to make edits to your project without opening your IDE.
- **Switch between hundreds of LLMs without constraints.** Other CLI tools only work with one model or curate opinionated lists. With Kilo, you can switch models without booting up another tool.
- **Choose the right mode for the task in your workflow.** Select between Architect, Ask, Debug, Orchestrator, or custom agent modes.
- **Automate tasks.** Get AI assistance writing shell scripts for tasks like renaming all of the files in a folder or transforming sizes for a set of images.
- **Extend capabilities with skills.** Add domain expertise and repeatable workflows through [Agent Skills](#skills).

## CLI Reference

### Top-Level CLI Commands

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| `kilo [project]`          | Start the TUI (Terminal User Interface)    |
| `kilo run [message..]`    | Run with a message (non-interactive mode)  |
| `kilo attach <url>`       | Attach to a running kilo server            |
| `kilo serve`              | Start a headless server                    |
| `kilo web`                | Start server and open web interface        |
| `kilo auth`               | Manage credentials (login, logout, list)   |
| `kilo agent`              | Manage agents (create, list)               |
| `kilo mcp`                | Manage MCP servers (list, add, auth)       |
| `kilo models [provider]`  | List available models                      |
| `kilo stats`              | Show token usage and cost statistics       |
| `kilo session`            | Manage sessions (list)                     |
| `kilo export [sessionID]` | Export session data as JSON                |
| `kilo import <file>`      | Import session data from JSON file or URL  |
| `kilo upgrade [target]`   | Upgrade kilo to latest or specific version |
| `kilo uninstall`          | Uninstall kilo and remove related files    |
| `kilo pr <number>`        | Fetch and checkout a GitHub PR branch      |
| `kilo github`             | Manage GitHub agent (install, run)         |
| `kilo debug`              | Debugging and troubleshooting tools        |
| `kilo completion`         | Generate shell completion script           |

### Global Options

| Flag              | Description                         |
| ----------------- | ----------------------------------- |
| `--help`, `-h`    | Show help                           |
| `--version`, `-v` | Show version number                 |
| `--print-logs`    | Print logs to stderr                |
| `--log-level`     | Log level: DEBUG, INFO, WARN, ERROR |

### Interactive Slash Commands

#### Session Commands

| Command       | Aliases                | Description               |
| ------------- | ---------------------- | ------------------------- |
| `/sessions`   | `/resume`, `/continue` | Switch session            |
| `/new`        | `/clear`               | New session               |
| `/share`      | -                      | Share session             |
| `/unshare`    | -                      | Unshare session           |
| `/rename`     | -                      | Rename session            |
| `/timeline`   | -                      | Jump to message           |
| `/fork`       | -                      | Fork from message         |
| `/compact`    | `/summarize`           | Compact/summarize session |
| `/undo`       | -                      | Undo previous message     |
| `/redo`       | -                      | Redo message              |
| `/copy`       | -                      | Copy session transcript   |
| `/export`     | -                      | Export session transcript |
| `/timestamps` | `/toggle-timestamps`   | Show/hide timestamps      |
| `/thinking`   | `/toggle-thinking`     | Show/hide thinking blocks |

#### Agent & Model Commands

| Command   | Description  |
| --------- | ------------ |
| `/models` | Switch model |
| `/agents` | Switch agent |
| `/mcps`   | Toggle MCPs  |

#### Provider Commands

| Command    | Description                                                               |
| ---------- | ------------------------------------------------------------------------- |
| `/connect` | Connect/add a provider - entry point for new users to add API credentials |

#### System Commands

| Command   | Aliases       | Description          |
| --------- | ------------- | -------------------- |
| `/status` | -             | View status          |
| `/themes` | -             | Switch theme         |
| `/help`   | -             | Show help            |
| `/editor` | -             | Open external editor |
| `/exit`   | `/quit`, `/q` | Exit the app         |

#### Kilo Gateway Commands (when connected)

| Command    | Aliases                  | Description                       |
| ---------- | ------------------------ | --------------------------------- |
| `/profile` | `/me`, `/whoami`         | View your Kilo Gateway profile    |
| `/teams`   | `/team`, `/org`, `/orgs` | Switch between Kilo Gateway teams |

#### Built-in Commands

| Command                     | Description                                  |
| --------------------------- | -------------------------------------------- |
| `/init`                     | Create/update AGENTS.md file for the project |
| `/local-review`             | Review code changes                          |
| `/local-review-uncommitted` | Review uncommitted changes                   |

## Local Code Reviews

Review your code locally before pushing — catch issues early without waiting for PR reviews. Local code reviews give you AI-powered feedback on your changes without creating a public pull request.

### Commands

| Command                     | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `/local-review`             | Review current branch changes vs base branch   |
| `/local-review-uncommitted` | Review uncommitted changes (staged + unstaged) |

## Config Reference

Configuration is managed through:

- `/connect` command for provider setup (interactive)
- Config files directly at `~/.kilocode/config.json`
- `kilo auth` for credential management

## Auto-approval Settings

Auto-approval allows the Kilo Code CLI to perform operations without first requiring user confirmation. These settings can either be built up over time in interactive mode, or by editing your config file directly at `~/.kilocode/config.json`.

### Default Auto-approval Settings

```json
{
	"autoApproval": {
		"enabled": true,
		"read": {
			"enabled": true,
			"outside": false
		},
		"write": {
			"enabled": true,
			"outside": false,
			"protected": false
		},
		"execute": {
			"enabled": true,
			"allowed": ["npm", "git", "pnpm"],
			"denied": ["rm -rf", "sudo"]
		},
		"browser": {
			"enabled": false
		},
		"mcp": {
			"enabled": true
		},
		"mode": {
			"enabled": true
		},
		"subtasks": {
			"enabled": true
		},
		"question": {
			"enabled": false,
			"timeout": 60
		},
		"retry": {
			"enabled": true,
			"delay": 10
		},
		"todo": {
			"enabled": true
		}
	}
}
```

**Configuration Options:**

- `read`: Auto-approve file read operations
    - `outside`: Allow reading files outside workspace
- `write`: Auto-approve file write operations
    - `outside`: Allow writing files outside workspace
    - `protected`: Allow writing to protected files (e.g., package.json)
- `execute`: Auto-approve command execution
    - `allowed`: List of allowed command patterns (e.g., ["npm", "git"])
    - `denied`: List of denied command patterns (takes precedence)
- `browser`: Auto-approve browser operations
- `mcp`: Auto-approve MCP tool usage
- `mode`: Auto-approve mode switching
- `subtasks`: Auto-approve subtask creation
- `question`: Auto-approve follow-up questions
- `retry`: Auto-approve API retry requests
- `todo`: Auto-approve todo list updates

### Command Approval Patterns

The `execute.allowed` and `execute.denied` lists support hierarchical pattern matching:

- **Base command**: `"git"` matches any git command (e.g., `git status`, `git commit`, `git push`)
- **Command + subcommand**: `"git status"` matches any git status command (e.g., `git status --short`, `git status -v`)
- **Full command**: `"git status --short"` only matches exactly `git status --short`

**Example:**

```json
{
	"execute": {
		"enabled": true,
		"allowed": [
			"npm", // Allows all npm commands
			"git status", // Allows all git status commands
			"ls -la" // Only allows exactly "ls -la"
		],
		"denied": [
			"git push --force" // Denies this specific command even if "git" is allowed
		]
	}
}
```

## Interactive Mode

Interactive mode is the default mode when running Kilo Code without the `--auto` flag, designed to work interactively with a user through the console.

In interactive mode Kilo Code will request approval for operations which have not been auto-approved, allowing the user to review and approve operations before they are executed, and optionally add them to the auto-approval list.

### Interactive Command Approval

When running in interactive mode, command approval requests show hierarchical options:

```
[!] Action Required:
> ✓ Run Command (y)
  ✓ Always run git (1)
  ✓ Always run git status (2)
  ✓ Always run git status --short --branch (3)
  ✗ Reject (n)
```

Selecting an "Always run" option will:

1. Approve and execute the current command
2. Add the pattern to your `execute.allowed` list in the config
3. Auto-approve matching commands in the future

This allows you to progressively build your auto-approval rules without manually editing the config file.

## Autonomous Mode (Non-Interactive)

Autonomous mode allows Kilo Code to run in automated environments like CI/CD pipelines without requiring user interaction.

```bash
# Run in autonomous mode with a message
kilo run --auto "Implement feature X"
```

### Autonomous Mode Behavior

When running in autonomous mode:

1. **No User Interaction**: All approval requests are handled automatically based on configuration
2. **Auto-Approval/Rejection**: Operations are approved or rejected based on your auto-approval settings
3. **Follow-up Questions**: Automatically responded with a message instructing the AI to make autonomous decisions
4. **Automatic Exit**: The CLI exits automatically when the task completes or times out

### Auto-Approval in Autonomous Mode

Autonomous mode respects your [auto-approval configuration](#auto-approval-settings). Operations which are not auto-approved will not be allowed.

### Autonomous Mode Follow-up Questions

In autonomous mode, when the AI asks a follow-up question, it receives this response:

> "This process is running in non-interactive autonomous mode. The user cannot make decisions, so you should make the decision autonomously."

This instructs the AI to proceed without user input.

### Exit Codes

- `0`: Success (task completed)
- `124`: Timeout (task exceeded time limit)
- `1`: Error (initialization or execution failure)

### Example CI/CD Integration

```yaml
# GitHub Actions example
- name: Run Kilo Code
  run: |
      kilo run "Implement the new feature" --auto
```

## Session Continuation

Resume your last conversation from the current workspace using the `--continue` (or `-c`) flag:

```bash
# Resume the most recent session from this workspace
kilo --continue
kilo -c
```

This feature:

- Automatically finds the most recent session from the current workspace
- Loads the full conversation history
- Allows you to continue where you left off
- Cannot be used with autonomous mode or with a prompt argument
- Exits with an error if no previous sessions are found

**Example workflow:**

```bash
# Start a session
kilo
# > "Create a REST API"
# ... work on the task ...
# Exit with /exit

# Later, resume the same session
kilo --continue
# Conversation history is restored, ready to continue
```

**Limitations:**

- Cannot be combined with autonomous mode
- Cannot be used with a prompt argument
- Only works when there's at least one previous session in the workspace

## Environment Variable Overrides

The CLI supports overriding config values with environment variables. The supported environment variables are:

- `KILO_PROVIDER`: Override the active provider ID
- For `kilocode` provider: `KILOCODE_<FIELD_NAME>` (e.g., `KILOCODE_MODEL` → `kilocodeModel`)
- For other providers: `KILO_<FIELD_NAME>` (e.g., `KILO_API_KEY` → `apiKey`)

## Switching into an Organization from the CLI

Use the `/teams` command to see a list of all organizations you can switch into.

Use `/teams` and select a team to switch teams.

The process is the same when switching into a Team or Enterprise organization.

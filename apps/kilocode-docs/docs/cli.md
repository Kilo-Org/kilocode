# Kilo Code CLI

Orchestrate agents from your terminal. Plan, debug, and code fast with keyboard-first navigation on the command line.

The Kilo Code CLI uses the same underlying technology that powers the IDE extensions, so you can expect the same workflow to handle agentic coding tasks from start to finish.

## Install

`npm install -g @kilocode/cli`

Change directory to where you want to work and run kilocode:

```bash
# Start interactive chat session
kilocode

# Start with a specific mode
kilocode --mode architect

# Start with a specific workspace
kilocode --workspace /path/to/project

# Resume last conversation from current workspace
kilocode --continue
```

to start the CLI and begin a new task with your preferred model and relevant mode.

## What you can do with Kilo Code CLI

- **Plan and execute code changes without leaving your terminal.** Use your command line to make edits to your project without opening your IDE.
- **Switch between hundreds of LLMs without constraints.** Other CLI tools only work with one model or curate opinionated lists. With Kilo, you can switch models without booting up another tool.
- **Choose the right mode for the task in your workflow.** Select between Architect, Ask, Debug, Orchestrator, or custom agent modes.
- **Automate tasks.** Get AI assistance writing shell scripts for tasks like renaming all of the files in a folder or transforming sizes for a set of images.

## CLI reference

### CLI commands

| Command               | Description                                                      | Example                        |
| --------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `kilocode`            | Start interactive                                                |                                |
| `/mode`               | Switch between modes (architect, code, debug, ask, orchestrator) | `/mode orchestrator`           |
| `/model`              | Learn about available models and switch between them             |                                |
| `/model list`         | List available models                                            |                                |
| `/model info`         | Prints description for a specific model by name                  | `/model info z-ai/glm-4.5v`    |
| `/model select`       | Select and switch to a new model                                 |                                |
| `/checkpoint list`    | List all available checkpoints                                   |                                |
| `/checkpoint restore` | Revert to a specific checkpoint (destructive action)             | `/checkpoint restore 41db173a` |
| `/tasks`              | View task history                                                |                                |
| `/tasks search`       | Search tasks by query                                            | `/tasks search bug fix`        |
| `/tasks select`       | Switch to a specific task                                        | `/tasks select abc123`         |
| `/tasks page`         | Go to a specific page                                            | `/tasks page 2`                |
| `/tasks next`         | Go to next page of task history                                  |                                |
| `/tasks prev`         | Go to previous page of task history                              |                                |
| `/tasks sort`         | Change sort order                                                | `/tasks sort most-expensive`   |
| `/tasks filter`       | Filter tasks                                                     | `/tasks filter favorites`      |
| `/teams`              | List all organizations you can switch into                       |                                |
| `/teams select`       | Switch to a different organization                               |                                |
| `/config`             | Open configuration editor (same as `kilocode config`)            |                                |
| `/new`                | Start a new task with the agent with a clean slate               |                                |
| `/help`               | List available commands and how to use them                      |                                |
| `/exit`               | Exit the CLI                                                     |                                |

## Checkpoint Management

Kilo Code automatically creates checkpoints as you work, allowing you to revert to previous states in your project's history.

### Viewing Checkpoints

List all available checkpoints with `/checkpoint list`:

```bash
/checkpoint list
```

This displays:

- Full 40-character git commit hash
- Relative timestamp (e.g., "5 minutes ago", "2 hours ago")
- Auto-saved checkpoints are marked with `[auto-saved]`

### Restoring Checkpoints

Revert to a specific checkpoint using the full git hash:

```bash
/checkpoint restore 00d185d5020969752bc9ae40823b9d6a723696e2
```

:::danger Warning
Checkpoint restoration is a **destructive action**:

- Performs a git hard reset (all uncommitted changes will be lost)
- Removes all messages from the conversation after the checkpoint
- Cannot be undone

Make sure you've committed or backed up any work you want to keep before restoring.
:::

**Aliases:** `/cp` can be used as a shorthand for `/checkpoint`

## Task History

View, search, and navigate through your task history directly from the CLI.

### Viewing Task History

Display your task history with `/tasks`:

```bash
/tasks
```

This shows:

- Task number and description
- Task ID (for selecting)
- Relative timestamp
- Cost in dollars
- Token usage
- Favorite indicator (⭐) for favorited tasks
- Pagination (10 tasks per page)

### Searching Tasks

Search for specific tasks by keyword:

```bash
/tasks search bug fix
/tasks search implement feature
```

Search automatically sorts results by relevance.

### Selecting a Task

Switch to a specific task using its ID:

```bash
/tasks select abc123
```

This loads the selected task and its full conversation history.

### Pagination

Navigate through pages of task history:

```bash
/tasks page 2      # Go to page 2
/tasks next        # Go to next page
/tasks prev        # Go to previous page
```

### Sorting Tasks

Sort tasks by different criteria:

```bash
/tasks sort newest          # Most recent first (default)
/tasks sort oldest          # Oldest first
/tasks sort most-expensive  # Highest cost first
/tasks sort most-tokens     # Most tokens used first
/tasks sort most-relevant   # Most relevant (used with search)
```

### Filtering Tasks

Filter tasks by workspace or favorites:

```bash
/tasks filter current    # Show only tasks from current workspace
/tasks filter all        # Show tasks from all workspaces
/tasks filter favorites  # Show only favorited tasks
/tasks filter all-tasks  # Show all tasks (remove filters)
```

**Aliases:** `/t` and `/history` can be used as shorthand for `/tasks`

## Config reference for providers

Kilo gives you the ability to bring your own keys for a number of model providers and AI gateways, like OpenRouter and Vercel AI Gateway. Each provider has unique configuration options and some let you set environment variables.

You can reference the [Provider Configuration Guide](https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md) for examples if you want to edit .config files manually. You can also run:

`kilocode config`

to complete configuration with an interactive workflow on the command line.

:::tip
You can also use the `/config` slash command during an interactive session, which is equivalent to running `kilocode config`.
:::

## Parallel mode

Parallel mode allows multiple Kilo Code instances to work in parallel on the same directory, without conflicts. You can spawn as many Kilo Code instances as you need! Once finished, changes will be available on a separate git branch.

```bash
# Prerequisite: must be within a valid git repository

# In interactive mode, changes will be committed on /exit
# Terminal 1
kilocode --parallel "improve xyz"
# Terminal 2
kilocode --parallel "improve abc"

# Pairs great with auto mode 🚀
# Terminal 1
kilocode --parallel --auto "improve xyz"
# Terminal 2
kilocode --parallel --auto "improve abc"
```

## Autonomous mode (Non-Interactive)

Autonomous mode allows Kilo Code to run in automated environments like CI/CD pipelines without requiring user interaction.

```bash
# Run in autonomous mode with a prompt
kilocode --auto "Implement feature X"

# Run in autonomous mode with piped input
echo "Fix the bug in app.ts" | kilocode --auto

# Run in autonomous mode with timeout (in seconds)
kilocode --auto "Run tests" --timeout 300

# Run in autonomous mode with JSON output for structured parsing
kilocode --auto --json "Implement feature X"
```

### Autonomous Mode Behavior

When running in Autonomous mode (`--auto` flag):

1. **No User Interaction**: All approval requests are handled automatically based on configuration
2. **Auto-Approval/Rejection**: Operations are approved or rejected based on your auto-approval settings
3. **Follow-up Questions**: Automatically responded with a message instructing the AI to make autonomous decisions
4. **Automatic Exit**: The CLI exits automatically when the task completes or times out

### JSON Output Mode

Use the `--json` flag with `--auto` to get structured JSON output instead of the default terminal UI. This is useful for programmatic integration and parsing of Kilo Code responses.

```bash
# Standard autonomous mode with terminal UI
kilocode --auto "Fix the bug"

# Autonomous mode with JSON output
kilocode --auto --json "Fix the bug"

# With piped input
echo "Implement feature X" | kilocode --auto --json
```

**Requirements:**

- The `--json` flag requires `--auto` mode to be enabled
- Output is sent to stdout as structured JSON for easy parsing
- Ideal for CI/CD pipelines and automated workflows

### Auto-Approval Configuration

Autonomous mode respects your auto-approval configuration. Edit your config file with `kilocode config` to customize:

```json
{
	"autoApproval": {
		"enabled": true,
		"read": {
			"enabled": true,
			"outside": true
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

### Interactive Command Approval

When running in interactive mode, command approval requests now show hierarchical options:

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

### Autonomous Mode Follow-up Questions

In Autonomous mode, when the AI asks a follow-up question, it receives this response:

> "This process is running in non-interactive Autonomous mode. The user cannot make decisions, so you should make the decision autonomously."

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
      echo "Implement the new feature" | kilocode --auto --timeout 600
```

## Session Continuation

Resume your last conversation from the current workspace using the `--continue` (or `-c`) flag:

```bash
# Resume the most recent task from this workspace
kilocode --continue
kilocode -c
```

This feature:

- Automatically finds the most recent task from the current workspace
- Loads the full conversation history
- Allows you to continue where you left off
- Cannot be used with `--auto` mode or with a prompt argument
- Exits with an error if no previous tasks are found

**Example workflow:**

```bash
# Start a task
kilocode
# > "Create a REST API"
# ... work on the task ...
# Exit with /exit

# Later, resume the same task
kilocode --continue
# Conversation history is restored, ready to continue
```

**Limitations:**

- Cannot be combined with `--auto` mode
- Cannot be used with a prompt argument
- Only works when there's at least one previous task in the workspace

## ACP Mode (Agent Client Protocol)

ACP mode enables Kilo Code to integrate with code editors that support the [Agent Client Protocol](https://agentclientprotocol.com/), such as [Zed](https://zed.dev/). This allows you to use Kilo Code as an AI coding agent directly within your editor.

### What is ACP?

The Agent Client Protocol (ACP) is a standardized protocol for communication between code editors and AI coding agents. It enables:

- **Seamless editor integration**: Use Kilo Code directly in your editor's AI panel
- **Human-in-the-loop approval**: Review and approve tool actions before they execute
- **Streaming responses**: See agent responses as they're generated
- **Context awareness**: The agent has access to your workspace and can read/write files

### Running in ACP Mode

```bash
# Run the CLI in ACP mode
kilocode --acp

# Run with a specific workspace
kilocode --acp --workspace /path/to/project
```

When running in ACP mode, the CLI:

1. Communicates over stdin/stdout using JSON-RPC 2.0
2. Waits for commands from the connected editor
3. Requests permission from the user before executing tools
4. Streams responses back to the editor in real-time

### Full Build from Source

If running from a fresh clone or the extension files are missing, build everything:

```bash
# 1. Install dependencies (from repo root)
pnpm install

# 2. Build the VS Code extension
cd src && pnpm bundle

# 3. Package and unpack the extension
pnpm vsix && pnpm vsix:unpacked

# 4. Build the CLI and copy extension files
cd ../cli && pnpm build && pnpm copy:kilocode

# 5. Run in ACP mode
node dist/index.js --acp --workspace /path/to/project
```

### Testing with Zed Editor

Follow these steps to test Kilo Code's ACP integration with Zed:

#### Prerequisites

1. **Install Kilo Code CLI globally**:

    ```bash
    npm install -g @kilocode/cli
    ```

2. **Verify the CLI is working**:

    ```bash
    kilocode --help | grep acp
    # Should show: --acp  Run in ACP (Agent Client Protocol) mode...
    ```

3. **Ensure you have a provider configured**:

    ```bash
    kilocode config
    # Configure your API provider (OpenRouter, Anthropic, etc.)
    ```

4. **Install Zed** (if not already installed):
    - Download from [zed.dev](https://zed.dev/)
    - Or on macOS: `brew install zed`

#### Configure Zed

1. Open Zed's settings file:

    - macOS: `~/.config/zed/settings.json`
    - Linux: `~/.config/zed/settings.json`
    - Or open Zed and press `Cmd/Ctrl + ,` then click "Open Settings (JSON)"

2. Add the Kilo Code agent server configuration:

```json
{
	"agent_servers": {
		"kilocode": {
			"type": "custom",
			"command": "kilocode",
			"args": ["--acp"],
			"env": {}
		}
	}
}
```

For local development, use the full path to the built CLI:

```json
{
	"agent_servers": {
		"kilocode-dev": {
			"type": "custom",
			"command": "node",
			"args": ["/path/to/kilocode/cli/dist/index.js", "--acp"],
			"env": {}
		}
	}
}
```

3. Save the file and restart Zed

#### Test the Integration

1. **Open a project in Zed**:

    ```bash
    cd /path/to/your/project
    zed .
    ```

2. **Open the AI panel**:

    - Press `Ctrl/Cmd + Shift + A`
    - Or use the menu: View → AI Panel

3. **Select the Kilo Code agent**:

    - Click the agent dropdown in the AI panel
    - Select "kilocode"

4. **Send a test message**:

    - Type a message like "What files are in this project?"
    - Press Enter to send

5. **Verify the response**:
    - You should see the agent streaming a response
    - Tool calls (like reading files) will prompt for approval in the editor

#### Troubleshooting

**Agent not appearing in Zed:**

- Ensure the CLI is installed globally and in your PATH
- Try running `which kilocode` to verify installation
- Check Zed's logs for error messages

**Connection errors:**

- Verify your provider API key is configured: `kilocode config`
- Check network connectivity
- Look at Zed's developer console for detailed errors

**Permission prompts not appearing:**

- Ensure you're using a recent version of Zed with ACP support
- The agent requires approval for file operations and commands

**Debugging mode:**

- Run `kilocode --acp` directly in a terminal to see raw JSON-RPC messages
- This can help identify protocol-level issues

### Supported ACP Features

| Feature             | Status | Description                                         |
| ------------------- | ------ | --------------------------------------------------- |
| `initialize`        | ✅     | Establish connection and negotiate capabilities     |
| `newSession`        | ✅     | Create a new conversation session                   |
| `prompt`            | ✅     | Send user messages and receive agent responses      |
| `cancel`            | ✅     | Cancel an ongoing operation                         |
| `sessionUpdate`     | ✅     | Stream agent responses in real-time                 |
| `requestPermission` | ✅     | Request user approval for tool actions              |
| `setSessionMode`    | ✅     | Switch between modes (architect, code, debug, etc.) |

### Known Limitations

#### State Synchronization Bridge

The ACP implementation bridges two different communication models:

- **Kilo Code Extension**: Uses state synchronization (full state snapshots on every update)
- **ACP Protocol**: Expects incremental streaming (chunked content updates)

To derive incremental updates from state snapshots, the agent tracks sent messages to avoid duplicates. This adds some complexity but works reliably.

**Future Improvement:** A more efficient implementation would have the CLI emit streaming events directly from the LLM, rather than batching into full state updates.

#### Other Current Limitations

- **Image support**: Not yet implemented
- **Session persistence**: Sessions are ephemeral (no `loadSession` support)
- **MCP servers**: Connection parameters accepted but servers not automatically connected

### How Tool Approval Works

When Kilo Code needs to perform an action (like writing a file or running a command), it requests permission from the editor. The editor displays this to the user, who can:

- **Allow**: Execute the action
- **Deny**: Reject the action and continue

This ensures you maintain control over what changes the agent makes to your codebase.

### Notes

- ACP mode is designed for editor integration, not direct terminal use
- Your provider configuration from `kilocode config` is used for API access
- The same modes (architect, code, debug, etc.) are available as in the standard CLI

## Environment Variable Overrides

The CLI supports overriding config values with environment variables. The supported environment variables are:

- `KILO_PROVIDER`: Override the active provider ID
- For `kilocode` provider: `KILOCODE_<FIELD_NAME>` (e.g., `KILOCODE_MODEL` → `kilocodeModel`)
- For other providers: `KILO_<FIELD_NAME>` (e.g., `KILO_API_KEY` → `apiKey`)

## Local Development

### DevTools

In order to run the CLI with devtools, add `DEV=true` to your `pnpm start` command, and then run `npx react-devtools` to show the devtools inspector.

## Switching into an Organization from the CLI

Use the `/teams` command to see a list of all organizations you can switch into.

Use `/teams select` and start typing the team name to switch teams.

The process is the same when switching into a Team or Enterprise organization.

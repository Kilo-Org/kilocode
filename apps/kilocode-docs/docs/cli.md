# Kilo Code CLI

Orchestrate agents from your terminal. Plan, debug, and code fast with keyboard-first navigation on the command line.

The Kilo Code CLI uses the same underlying technology that powers the IDE extensions, so you can expect the same workflow to handle agentic coding tasks from start to finish.

## Install

`npm install -g @kilocode/cli`

Change directory to where you want to work and run kilocode:

```
# Start interactive chat session
kilocode

# Start with a specific mode
kilocode --mode architect

# Start with a specific workspace
kilocode --workspace /path/to/project
```

to start the CLI and begin a new task with your preferred model and relevant mode.

## What you can do with Kilo Code CLI

- **Plan and execute code changes without leaving your terminal.** Use your command line to make edits to your project without opening your IDE.
- **Switch between hundreds of LLMs without constraints.** Other CLI tools only work with one model or curate opinionated lists. With Kilo, you can switch models without booting up another tool.
- **Choose the right mode for the task in your workflow.** Select between Architect, Ask, Debug, Orchestrator, or custom agent modes.
- **Automate tasks.** Get AI assistance writing shell scripts for tasks like renaming all of the files in a folder or transforming sizes for a set of images.

## CLI reference

### CLI commands

| Command         | Description                                                      | Example                     |
| --------------- | ---------------------------------------------------------------- | --------------------------- |
| `kilocode`      | Start interactive                                                |                             |
| `/mode`         | Switch between modes (architect, code, debug, ask, orchestrator) | `/mode orchestrator`        |
| `/model`        | Learn about available models and switch between them             |                             |
| `/model list`   | List available models                                            |                             |
| `/model info`   | Prints description for a specific model by name                  | `/model info z-ai/glm-4.5v` |
| `/model select` | Select and switch to a new model                                 |                             |
| `/teams`        | List all organizations you can switch into                       |                             |
| `/teams select` | Switch to a different organization                               |                             |
| `/config`       | Open configuration editor (same as `kilocode config`)            |                             |
| `/new`          | Start a new task with the agent with a clean slate               |                             |
| `/help`         | List available commands and how to use them                      |                             |
| `/exit`         | Exit the CLI                                                     |                             |

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
```

### Autonomous Mode Behavior

When running in Autonomous mode (`--auto` flag):

1. **No User Interaction**: All approval requests are handled automatically based on configuration
2. **Auto-Approval/Rejection**: Operations are approved or rejected based on your auto-approval settings
3. **Follow-up Questions**: Automatically responded with a message instructing the AI to make autonomous decisions
4. **Automatic Exit**: The CLI exits automatically when the task completes or times out

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

# Kilo Code CLI

Terminal User Interface for Kilo Code

## Installation

```bash
npm install -g @kilocode/cli
```

Then, make sure you place your Kilo Code API token in the CLI config:

```bash
kilocode config # this opens up your editor
```

You can find your Kilo Code API token on your profile page at [app.kilo.ai](https://app.kilo.ai), and place it in the `kilocodeToken` field in the CLI config.

## Known Issues

### Theme Detection

We don't detect the theme of your terminal, and are aware the the current theme doesn't work well on light mode terminals. Switch to the light theme using using `kilocode config`.

### Outdated dependency warnings

When installing Kilo Code CLI you'll be greeted by some scary looking dependency deprecation warnings. We're aware of the issue and will resolve it shortly.

### Windows Support

We've only tested the CLI on Mac and Linux, and are aware that there are some issues on Windows. For now, if you can, we advise you to use a WSL environment to run the CLI.

## Usage

### Interactive Mode

```bash
# Start interactive chat session
kilocode

# Start with a specific mode
kilocode --mode architect

# Start with a specific workspace
kilocode --workspace /path/to/project

# Resume the last conversation from this workspace
kilocode -c
# or
kilocode --continue
```

### Parallel mode

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

### Autonomous mode (Non-Interactive)

Autonomous mode allows Kilo Code to run in automated environments like CI/CD pipelines without requiring user interaction.

```bash
# Run in autonomous mode with a prompt
kilocode --auto "Implement feature X"

# Run in autonomous mode with piped input
echo "Fix the bug in app.ts" | kilocode --auto

# Run in autonomous mode with timeout (in seconds)
kilocode --auto "Run tests" --timeout 300
```

#### Autonomous mode Behavior

When running in Autonomous mode (`--auto` flag):

1. **No User Interaction**: All approval requests are handled automatically based on configuration
2. **Auto-Approval/Rejection**: Operations are approved or rejected based on your auto-approval settings
3. **Follow-up Questions**: Automatically responded with a message instructing the AI to make autonomous decisions
4. **Automatic Exit**: The CLI exits automatically when the task completes or times out

#### Auto-Approval Configuration

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

#### Command Approval Patterns

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

#### Interactive Command Approval

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

#### Autonomous mode Follow-up Questions

In Autonomous mode, when the AI asks a follow-up question, it receives this response:

> "This process is running in non-interactive Autonomous mode. The user cannot make decisions, so you should make the decision autonomously."

This instructs the AI to proceed without user input.

#### Exit Codes

- `0`: Success (task completed)
- `124`: Timeout (task exceeded time limit)
- `130`: SIGINT interruption (Ctrl+C)
- `143`: SIGTERM interruption (system termination)
- `1`: Error (initialization or execution failure)

#### Example CI/CD Integration

```yaml
# GitHub Actions example
- name: Run Kilo Code
  run: |
      echo "Implement the new feature" | kilocode --auto --timeout 600
```

## Local Development

### Getting Started

To build and run the CLI locally off your branch:

#### Build the VS Code extension

```shell
cd src
pnpm bundle
pnpm vsix
pnpm vsix:unpackged
cd ..
```

#### Install CLI dependencies

```shell
cd cli
pnpm install
pnpm deps:install
```

#### Build the CLI

```shell
pnpm clean
pnpm clean:kilocode
pnpm copy:kilocode
pnpm build
```

#### Configure CLI settings

```shell
pnpm start config
```

#### Run the built CLI

```shell
pnpm start
```

### Using DevTools

In order to run the CLI with devtools, add `DEV=true` to your `pnpm start` command, and then run `npx react-devtools` to show the devtools inspector.

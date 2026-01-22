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

## Update

Upgrade the Kilo CLI package:

`npm update -g @kilocode/cli`

## What you can do with Kilo Code CLI

- **Plan and execute code changes without leaving your terminal.** Use your command line to make edits to your project without opening your IDE.
- **Switch between hundreds of LLMs without constraints.** Other CLI tools only work with one model or curate opinionated lists. With Kilo, you can switch models without booting up another tool.
- **Choose the right mode for the task in your workflow.** Select between Architect, Ask, Debug, Orchestrator, or custom agent modes.
- **Automate tasks.** Get AI assistance writing shell scripts for tasks like renaming all of the files in a folder or transforming sizes for a set of images.
- **Extend capabilities with skills.** Add domain expertise and repeatable workflows through [Agent Skills](#skills).

## CLI reference

### Keyboard shortcuts

| Shortcut    | Description                                                                        |
| ----------- | ---------------------------------------------------------------------------------- |
| `Shift+Tab` | Cycle through modes (architect → code → ask → debug → orchestrator → custom modes) |
| `Ctrl+C`    | Exit (press twice to confirm)                                                      |
| `Ctrl+X`    | Cancel current task                                                                |
| `Esc`       | Cancel current task (while streaming) or clear input                               |
| `Ctrl+Y`    | Toggle YOLO mode (auto-approve all operations)                                     |
| `Ctrl+R`    | Resume task (when a task is ready to resume)                                       |
| `!`         | Enter shell mode (when input is empty)                                             |
| `↑/↓`       | Navigate command history (when input is empty)                                     |

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

## Skills

The CLI supports [Agent Skills](https://agentskills.io/), a lightweight format for extending AI capabilities with specialized knowledge and workflows.

Skills are discovered from:

- **Global skills**: `~/.kilocode/skills/` (available in all projects)
- **Project skills**: `.kilocode/skills/` (project-specific)

Skills can be:

- **Generic** - Available in all modes
- **Mode-specific** - Only loaded when using a particular mode (e.g., `code`, `architect`)

For example:

```
your-project/
└── .kilocode/
    ├── skills/               # Generic skills for this project
    │   └── project-conventions/
    │       └── SKILL.md
    └── skills-code/          # Code mode skills for this project
        └── linting-rules/
            └── SKILL.md
```

### Adding a Skill

1. Create the skill directory:

    ```bash
    mkdir -p ~/.kilocode/skills/api-design
    ```

2. Create a `SKILL.md` file with YAML frontmatter:

    ```markdown
    ---
    name: api-design
    description: REST API design best practices and conventions
    ---

    # API Design Guidelines

    When designing REST APIs, follow these conventions...
    ```

    The `name` field must match the directory name exactly.

3. Start a new CLI session to load the skill

#### Finding skills

There are community efforts to build and share agent skills. Some resources include:

- [Skills Marketplace](https://skillsmp.com/) - Community marketplace of skills
- [Skill Specification](https://agentskills.io/home) - Agent Skills specification

## Custom Commands

Custom commands allow you to create reusable slash commands that execute predefined prompts with argument substitution. They provide a convenient way to streamline repetitive tasks and standardize workflows.

Custom commands are discovered from:

- **Global commands**: `~/.kilocode/commands/` (available in all projects)
- **Project commands**: `.kilocode/commands/` (project-specific)

Commands are simple markdown files with YAML frontmatter for configuration.

### Creating a Custom Command

1. Create the commands directory:

    ```bash
    mkdir -p ~/.kilocode/commands # mkdir %USERPROFILE%\.kilocode\commands on windows
    ```

2. Create a markdown file (e.g., `component.md`):

    ```markdown
    ---
    description: Create a new React component
    arguments:
        - ComponentName
    ---

    Create a new React component named $1.
    Include:

    - Proper TypeScript typing
    - Basic component structure
    - Export statement
    - A simple props interface if appropriate

    Place it in the appropriate directory based on the project structure.
    ```

3. Use the command in your CLI session:

    ```bash
    /component Button
    ```

### Frontmatter Options

Custom commands support the following frontmatter fields:

- **`description`** (optional): Short description shown in `/help`
- **`arguments`** (optional): List of argument names for documentation
- **`mode`** (optional): Automatically switch to this mode when running the command
- **`model`** (optional): Automatically switch to this model when running the command

### Argument Substitution

Commands support powerful argument substitution:

- **`$ARGUMENTS`**: All arguments joined with spaces
- **`$1`, `$2`, `$3`, etc.**: Individual positional arguments

**Example:**

```markdown
---
description: Create a file with content
arguments:
    - filename
    - content
---

Create a new file named $1 with the following content:

$2
```

Usage: `/createfile app.ts "console.log('Hello')"`

### Mode and Model Switching

Commands can automatically switch modes and models:

```markdown
---
description: Run tests with coverage
mode: code
model: anthropic/claude-3-5-sonnet-20241022
---

Run the full test suite with coverage report and show any failures.
Focus on the failing tests and suggest fixes.
```

When you run `/test`, it will automatically switch to code mode and use the specified model.

### Example Commands

**Initialize project documentation:**

```markdown
---
description: Analyze codebase and create AGENTS.md
mode: code
---

Please analyze this codebase and create an AGENTS.md file containing:

1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions

Focus on project-specific, non-obvious information discovered by reading files.
```

**Refactor code:**

```markdown
---
description: Refactor code for better quality
arguments:
    - filepath
---

Refactor $1 to improve:

- Code readability
- Performance
- Maintainability
- Type safety

Explain the changes you make and why they improve the code.
```

### Command Priority

Project-specific commands override global commands with the same name, allowing you to customize behavior per project while maintaining sensible defaults globally.

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

## Auto-approval settings

Auto-approval allows the Kilo Code CLI to perform operations without first requiring user confirmation. These settings can either be built up over time in interactive mode, or by editing your config file using `kilocode config` or editing the file directly at `~/.kilocode/config.json`.

### Default auto-approval settings

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

### Auto-Approval in Autonomous Mode

Autonomous mode respects your [auto-approval configuration](#auto-approval-settings). Operations which are not auto-approved will not be allowed.

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

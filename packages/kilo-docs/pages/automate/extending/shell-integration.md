---
title: "Shell Integration"
description: "Integrate Kilo Code with your shell environment"
---

# Terminal Shell Integration

Terminal Shell Integration is a key feature that enables Kilo Code to execute commands in your terminal and intelligently process their output. This bidirectional communication between the AI and your development environment unlocks powerful automation capabilities.

## How Shell Execution Works

The new CLI and extension take a fundamentally different approach to shell execution. Instead of relying on VS Code's terminal shell integration, the CLI spawns and manages shell processes directly using the `bash` tool.

This means:

- **No VS Code shell integration required** — the CLI handles shell execution independently
- **No shell integration setup or troubleshooting** — it works out of the box
- **Consistent behavior** across environments — the same shell execution logic runs whether you use the CLI directly or through the VS Code extension

## The `bash` Tool

The `bash` tool is the primary way the agent executes shell commands. It spawns a persistent shell session and runs commands within it.

### Key Features

- **Working directory control**: Use the `workdir` parameter to run commands in a specific directory, instead of `cd <dir> && <command>` patterns
- **Configurable timeout**: Set a per-command timeout in milliseconds (defaults to 2 minutes)
- **Real-time output streaming**: Command output is streamed back as it's produced
- **Process tree management**: The tool manages the full process tree, ensuring child processes are properly cleaned up

### Security Analysis

Commands are parsed using **Tree-sitter** before execution, enabling:

- Path resolution to detect file access patterns
- External directory detection to flag commands that reach outside the project
- Structured analysis of command intent for safer auto-approval decisions

### Shell Detection

The CLI automatically detects the appropriate shell for your platform using `Shell.acceptable()`. This selects a compatible shell (bash, zsh, etc.) without requiring manual configuration.

## Agent Manager Terminals (VS Code Extension)

When using the Kilo Code VS Code extension with the Agent Manager, each agent session gets its own dedicated VS Code terminal.

### Per-Session Terminals

- Each session creates a terminal named **`Agent: {branch}`**, where `{branch}` is the git branch or worktree the session is working in
- The terminal's working directory is automatically set to the session's worktree directory
- Terminals are standard VS Code integrated terminals — you can interact with them directly

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Cmd</kbd>+<kbd>/</kbd> | Focus the session's terminal |
| <kbd>Cmd</kbd>+<kbd>.</kbd> | Cycle agent mode |

### Terminal Context Menu Actions

Right-click in an Agent Manager terminal to access these actions:

- **Add Terminal Content to Context** — sends the terminal's visible output to the agent as context
- **Fix This Command** — asks the agent to diagnose and fix the last failed command
- **Explain This Command** — asks the agent to explain what a command does

## Troubleshooting

Shell execution in the new CLI is significantly simpler than the **VSCode** version's terminal integration. Most issues are resolved by ensuring:

1. **A supported shell is installed**: bash or zsh on macOS/Linux, PowerShell on Windows
2. **The shell is on your PATH**: The CLI needs to find the shell binary
3. **File permissions are correct**: The CLI needs execute permission on the shell binary

If commands fail to execute, check the CLI's log output for error details. The CLI logs the shell it detected and any errors during command execution.

## Support

If you've followed these steps and are still experiencing problems, please:

1. Check the [Kilo Code GitHub Issues](https://github.com/Kilo-Org/kilocode/issues) to see if others have reported similar problems
2. If not, create a new issue with details about your operating system, VS Code/Cursor version, and the steps you've tried

For additional help, join our [Discord](https://kilo.ai/discord).

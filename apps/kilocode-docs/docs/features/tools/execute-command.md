# execute_command

The `execute_command` tool runs CLI commands on the user's system. It allows Kilo Code to perform system operations, install dependencies, build projects, start servers, and execute other terminal-based tasks needed to accomplish user objectives.

## Parameters

The tool accepts these parameters:

- `command` (required): The CLI command to execute. Must be valid for the user's operating system.
- `cwd` (optional): The working directory to execute the command in. If not provided, the current working directory is used.

## What It Does

This tool executes terminal commands directly on the user's system, enabling a wide range of operations from file manipulations to running development servers. Commands run in managed terminal instances with real-time output capture, integrated with VS Code's terminal system for optimal performance and security.

## When is it used?

- When installing project dependencies (npm install, pip install, etc.)
- When building or compiling code (make, npm run build, etc.)
- When starting development servers or running applications
- When initializing new projects (git init, npm init, etc.)
- When performing file operations beyond what other tools provide
- When running tests or linting operations
- When needing to execute specialized commands for specific technologies

## Key Features

- Integrates with VS Code shell API for reliable terminal execution
- Reuses terminal instances when possible through a registry system
- Captures command output line by line with real-time feedback
- Supports long-running commands that continue in the background
- Allows specification of custom working directories
- Maintains terminal history and state across command executions
- Handles complex command chains appropriate for the user's shell
- Provides detailed command completion status and exit code interpretation
- Supports interactive terminal applications with user feedback loop
- Shows terminals during execution for transparency
- Validates commands for security using shell-quote parsing
- Blocks potentially dangerous subshell execution patterns
- Integrates with KiloCodeIgnore system for file access control
- Handles terminal escape sequences for clean output

## Limitations

- Command access may be restricted by KiloCodeIgnore rules and security validations
- Commands with elevated permission requirements may need user configuration
- Behavior may vary across operating systems for certain commands
- Very long-running commands may require specific handling
- File paths should be properly escaped according to the OS shell rules
- Not all terminal features may work with remote development scenarios

## How It Works

When the `execute_command` tool is invoked, it follows this process:

1. **Command Validation and Security Checks**:

    - Parses the command using shell-quote to identify components
    - Validates against security restrictions (subshell usage, restricted files)
    - Checks against KiloCodeIgnore rules for file access permissions
    - Ensures the command meets system security requirements

2. **Terminal Management**:

    - Gets or creates a terminal through TerminalRegistry
    - Sets up the working directory context
    - Prepares event listeners for output capture
    - Shows the terminal for user visibility

3. **Command Execution and Monitoring**:

    - Executes via VS Code's shellIntegration API
    - Captures output with escape sequence processing
    - Throttles output handling (100ms intervals)
    - Monitors for command completion or errors
    - Detects "hot" processes like compilers for special handling

4. **Result Processing**:
    - Strips ANSI/VS Code escape sequences for clean output
    - Interprets exit codes with detailed signal information
    - Updates working directory tracking if changed by command
    - Provides command status with appropriate context

## Terminal Implementation Details

The tool uses a sophisticated terminal management system:

1. **First Priority: Terminal Reuse**

    - The TerminalRegistry tries to reuse existing terminals when possible
    - This reduces proliferation of terminal instances and improves performance
    - Terminal state (working directory, history) is preserved across commands

2. **Second Priority: Security Validation**

    - Commands are parsed using shell-quote for component analysis
    - Dangerous patterns like `$(...)` and backticks are blocked
    - Commands are checked against KiloCodeIgnore rules for file access control
    - A prefix-based allowlist system validates command patterns

3. **Performance Optimizations**

    - Output is processed in 100ms throttled intervals to prevent UI overload
    - Zero-copy buffer management uses index-based tracking for efficiency
    - Special handling for compilation and "hot" processes
    - Platform-specific optimizations for Windows PowerShell

4. **Error and Signal Handling**
    - Exit codes are mapped to detailed signal information (SIGTERM, SIGKILL, etc.)
    - Core dump detection for critical failures
    - Working directory changes are tracked and handled automatically
    - Clean recovery from terminal disconnection scenarios

## Examples When Used

- When setting up a new project, Kilo Code runs initialization commands like `npm init -y` followed by installing dependencies.
- When building a web application, Kilo Code executes build commands like `npm run build` to compile assets.
- When deploying code, Kilo Code runs git commands to commit and push changes to a repository.
- When troubleshooting, Kilo Code executes diagnostic commands to gather system information.
- When starting a development server, Kilo Code launches the appropriate server command (e.g., `npm start`).
- When running tests, Kilo Code executes the test runner command for the project's testing framework.

## Usage Examples

Running a simple command in the current directory:

```
<execute_command>
<command>npm run dev</command>
</execute_command>
```

Installing dependencies for a project:

```
<execute_command>
<command>npm install express mongodb mongoose dotenv</command>
</execute_command>
```

Running multiple commands in sequence:

```
<execute_command>
<command>mkdir -p src/components && touch src/components/App.js</command>
</execute_command>
```

Executing a command in a specific directory:

```
<execute_command>
<command>git status</command>
<cwd>./my-project</cwd>
</execute_command>
```

Building and then starting a project:

```
<execute_command>
<command>npm run build && npm start</command>
</execute_command>
```

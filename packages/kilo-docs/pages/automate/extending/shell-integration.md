---
title: "Shell Integration"
description: "Integrate Kilo Code with your shell environment"
---

# Terminal Shell Integration

Terminal Shell Integration is a key feature that enables Kilo Code to execute commands in your terminal and intelligently process their output. This bidirectional communication between the AI and your development environment unlocks powerful automation capabilities.

## What is Shell Integration?

Shell integration is automatically enabled in Kilo Code and connects directly to your terminal's command execution lifecycle without requiring any setup from you. This built-in feature allows Kilo Code to:

- Execute commands on your behalf through the [`execute_command`](/docs/features/tools/execute-command) tool
- Read command output in real-time without manual copy-pasting
- Automatically detect and fix errors in running applications
- Observe command exit codes to determine success or failure
- Track working directory changes as you navigate your project
- React intelligently to terminal output without user intervention

When Kilo Code needs to perform tasks like installing dependencies, starting a development server, or analyzing build errors, shell integration works behind the scenes to make these interactions smooth and effective.

## Getting Started with Shell Integration

Shell integration is built into Kilo Code and works automatically in most cases. If you see "Shell Integration Unavailable" messages or experience issues with command execution, try these solutions:

1. **Update VS Code/Cursor** to the latest version (VS Code 1.93+ required)
2. **Ensure a compatible shell is selected**: Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) → "Terminal: Select Default Profile" → Choose bash, zsh, PowerShell, or fish
3. **Windows PowerShell users**: Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` then restart VS Code
4. **WSL users**: Add `. "$(code --locate-shell-integration-path bash)"` to your `~/.bashrc`

## Terminal Integration Settings

Kilo Code provides several settings to fine-tune shell integration. Access these in the Kilo Code panel under Settings → Terminal.

### Basic Settings

#### Terminal Output Limit

{% image src="/docs/img/shell-integration/terminal-output-limit.png" alt="Terminal output limit slider set to 500" width="500" caption="Terminal output limit slider set to 500" /%}
Controls the maximum number of lines captured from terminal output. When exceeded, it keeps 20% of the beginning and 80% of the end with a truncation message in between. This prevents excessive token usage while maintaining context. Default: 500 lines.

#### Terminal Shell Integration Timeout

{% image src="/docs/img/shell-integration/shell-integration-timeout.png" alt="Terminal shell integration timeout slider set to 15s" width="500" caption="Terminal shell integration timeout slider set to 15s" /%}

Maximum time to wait for shell integration to initialize before executing commands. Increase this value if you experience "Shell Integration Unavailable" errors. Default: 15 seconds.

#### Terminal Command Delay

{% image src="/docs/img/shell-integration/terminal-command-delay.png" alt="Terminal command delay slider set to 0ms" width="500" caption="Terminal command delay slider set to 0ms" /%}

Adds a small pause after running commands to help Kilo Code capture all output correctly. This setting can significantly impact shell integration reliability due to VSCode's implementation of terminal integration across different operating systems and shell configurations:

- **Default**: 0ms
- **Common Values**:
    - 0ms: Works best for some users with newer VSCode versions
    - 50ms: Historical default, still effective for many users
    - 150ms: Recommended for PowerShell users
- **Note**: Different values may work better depending on your:
    - VSCode version
    - Shell customizations (oh-my-zsh, powerlevel10k, etc.)
    - Operating system and environment

### Advanced Settings

{% callout type="info" title="Important" %}
**Terminal restart required for these settings**

Changes to advanced terminal settings only take effect after restarting your terminals. To restart a terminal:

1. Click the trash icon in the terminal panel to close the current terminal
2. Open a new terminal with Terminal → New Terminal or <kbd>Ctrl</kbd>+<kbd>`</kbd> (backtick)

Always restart all open terminals after changing any of these settings.
{% /callout %}

#### PowerShell Counter Workaround

{% image src="/docs/img/shell-integration/power-shell-workaround.png" alt="PowerShell counter workaround checkbox" width="600" caption="PowerShell counter workaround checkbox" /%}

Helps PowerShell run the same command multiple times in a row. Enable this if you notice Kilo Code can't run identical commands consecutively in PowerShell.

#### Clear ZSH EOL Mark

{% image src="/docs/img/shell-integration/clear-zsh-eol-mark.png" alt="Clear ZSH EOL mark checkbox" width="600" caption="Clear ZSH EOL mark checkbox" /%}

Prevents ZSH from adding special characters at the end of output lines that can confuse Kilo Code when reading terminal results.

#### Oh My Zsh Integration

{% image src="/docs/img/shell-integration/oh-my-zsh.png" alt="Enable Oh My Zsh integration checkbox" width="600" caption="Enable Oh My Zsh integration checkbox" /%}

Makes Kilo Code work better with the popular [Oh My Zsh](https://ohmyz.sh/) shell customization framework. Turn this on if you use Oh My Zsh and experience terminal issues.

#### Powerlevel10k Integration

{% image src="/docs/img/shell-integration/power10k.png" alt="Enable Powerlevel10k integration checkbox" width="600" caption="Enable Powerlevel10k integration checkbox" /%}

Improves compatibility if you use the Powerlevel10k theme for ZSH. Turn this on if your fancy terminal prompt causes issues with Kilo Code.

#### ZDOTDIR Handling

{% image src="/docs/img/shell-integration/zdotdir.png" alt="Enable ZDOTDIR handling checkbox" width="600" caption="Enable ZDOTDIR handling checkbox" /%}

Helps Kilo Code work with custom ZSH configurations without interfering with your personal shell settings and customizations.

## Troubleshooting Shell Integration

### PowerShell Execution Policy (Windows)

PowerShell restricts script execution by default. To configure:

1. Open PowerShell as Administrator
2. Check current policy: `Get-ExecutionPolicy`
3. Set appropriate policy: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

Common policies:

- `Restricted`: No scripts allowed (default)
- `RemoteSigned`: Local scripts can run; downloaded scripts need signing
- `Unrestricted`: All scripts run with warnings
- `AllSigned`: All scripts must be signed

### Manual Shell Integration Installation

If automatic integration fails, add the appropriate line to your shell configuration:

**Bash** (`~/.bashrc`):

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path bash)"
```

**Zsh** (`~/.zshrc`):

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"
```

**PowerShell** (`$Profile`):

```powershell
if ($env:TERM_PROGRAM -eq "vscode") { . "$(code --locate-shell-integration-path pwsh)" }
```

**Fish** (`~/.config/fish/config.fish`):

```fish
string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)
```

### Terminal Customization Issues

If you use terminal customization tools:

**Powerlevel10k**:

```bash
# Add before sourcing powerlevel10k in ~/.zshrc
typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
```

**Alternative**: Enable the Powerlevel10k Integration setting in Kilo Code.

### Verifying Shell Integration Status

Confirm shell integration is active with these commands:

**Bash**:

```bash
set | grep -i '[16]33;'
echo "$PROMPT_COMMAND" | grep vsc
trap -p DEBUG | grep vsc
```

**Zsh**:

```zsh
functions | grep -i vsc
typeset -p precmd_functions preexec_functions
```

**PowerShell**:

```powershell
Get-Command -Name "*VSC*" -CommandType Function
Get-Content Function:\Prompt | Select-String "VSCode"
```

**Fish**:

```fish
functions | grep -i vsc
functions fish_prompt | grep -i vsc
```

Visual indicators of active shell integration:

1. Shell integration indicator in terminal title bar
2. Command detection highlighting
3. Working directory updates in terminal title
4. Command duration and exit code reporting

## WSL Terminal Integration Methods

When using Windows Subsystem for Linux (WSL), there are two distinct ways to use VSCode with WSL, each with different implications for shell integration:

### Method 1: VSCode Windows with WSL Terminal

In this setup:

- VSCode runs natively in Windows
- You use the WSL terminal integration feature in VSCode
- Shell commands are executed through the WSL bridge
- May experience additional latency due to Windows-WSL communication
- Shell integration markers may be affected by the WSL-Windows boundary: you must make sure that `source "$(code --locate-shell-integration-path <shell>)"` is loaded for your shell within the WSL environment because it may not get automatically loaded; see above.

### Method 2: VSCode Running Within WSL

In this setup:

- You launch VSCode directly from within WSL using `code .`
- VSCode server runs natively in the Linux environment
- Direct access to Linux filesystem and tools
- Better performance and reliability for shell integration
- Shell integration is loaded automatically since VSCode runs natively in the Linux environment
- Recommended approach for WSL development

For optimal shell integration with WSL, we recommend:

1. Open your WSL distribution
2. Navigate to your project directory
3. Launch VSCode using `code .`
4. Use the integrated terminal within VSCode

## Known Issues and Workarounds

### VS Code + Fish + Cygwin (Windows)

If you use Fish in Cygwin, a minimal setup is usually enough:

1. In your Cygwin Fish config (`~/.config/fish/config.fish`), add:

   ```fish
   string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)

2. Configure a terminal profile in VS Code that launches Fish (directly or via Cygwin bash).
3. Restart VS Code and open a new terminal to verify integration.

{% image src="/docs/img/shell-integration/shell-integration-8.png" alt="Fish Cygwin Integration Example" width="600" caption="Fish Cygwin Integration Example" /%}

### Shell Integration Failures After VS Code 1.98

**Issue**: After VS Code updates beyond version 1.98, shell integration may fail with the error "VSCE output start escape sequence (]633;C or ]133;C) not received".

**Solutions**:

1. **Set Terminal Command Delay**:

    - Set the Terminal Command Delay to 50ms in Kilo Code settings
    - Restart all terminals after changing this setting
    - This matches older default behavior and may resolve the issue; some users report 0ms works better depending on shell and environment. This is a workaround for upstream VS Code behavior.

2. **Roll Back VS Code Version**:

    - Download VS Code v1.98 from [VS Code Updates](https://code.visualstudio.com/updates/v1_98)
    - Replace your current VS Code installation
    - No backup of Kilo settings needed

3. **WSL-Specific Workaround**:

    - If using WSL, ensure you launch VSCode from within WSL using `code .`

4. **ZSH Users**:
    - Try enabling some or all ZSH-related workarounds in Kilo Code settings
    - These settings can help regardless of your operating system

## Additional Known Issues

### Ctrl+C Behavior

**Issue**: If text is already typed in the terminal when Kilo Code tries to run a command, Kilo Code will press Ctrl+C first to clear the line, which can interrupt running processes.

**Workaround**: Make sure your terminal prompt is empty (no partial commands typed) before asking Kilo Code to execute terminal commands.

### Multi-line Command Issues

**Issue**: Commands that span multiple lines can confuse Kilo Code and may show output from previous commands mixed in with current output.

**Workaround**: Instead of multi-line commands, use command chaining with `&&` to keep everything on one line (e.g., `echo a && echo b` instead of typing each command on a separate line).

### PowerShell-Specific Issues

1. **Premature Completion**: PowerShell sometimes tells Kilo Code a command is finished before all the output has been shown.
2. **Repeated Commands**: PowerShell may refuse to run the same command twice in a row.

**Workaround**: Enable the "PowerShell counter workaround" setting and set a terminal command delay of 150ms in the settings to give commands more time to complete.

### Incomplete Terminal Output

**Issue**: Sometimes VS Code doesn't show or capture all the output from a command.

**Workaround**: If you notice missing output, try closing and reopening the terminal tab, then run the command again. This refreshes the terminal connection.

## Troubleshooting Resources

### Checking Debug Logs

When shell integration issues occur, check the debug logs:

1. Open Help → Toggle Developer Tools → Console
2. Set "Show All Levels" to see all log messages
3. Look for messages containing `[Terminal Process]`
4. Check `preOutput` content in error messages:
    - Empty preOutput (`''`) means VS Code sent no data
    - This indicates a potential VS Code shell integration issue, or an upstream bug that is out of our control
    - The absence of shell integration markers may require adjusting settings to work around possible upstream bugs or local workstation configuration issues related to shell initialization and VS Code loading shell hooks

### Using the VS Code Terminal Integration Test Extension

The [VS Code Terminal Integration Test Extension](https://github.com/KJ7LNW/vsce-test-terminal-integration) helps diagnose shell integration issues by testing different settings combinations:

1. **When Commands Stall**:

    - If you see "command already running" warnings, click "Reset Stats" to reset the terminal state
    - These warnings indicate shell integration is not working
    - Try different settings combinations until you find one that works
    - If it really gets stuck, restart the extension by closing the window and pressing F5

2. **Testing Settings**:

    - Systematically try different combinations of:
        - Terminal Command Delay
        - Shell Integration settings
    - Document which combinations succeed or fail
    - This helps identify patterns in shell integration issues

3. **Reporting Issues**:
    - Once you find a problematic configuration
    - Document the exact settings combination
    - Note your environment (OS, VS Code version, shell, and any shell prompt customization)
    - Open an issue with these details to help improve shell integration

## Support

If you've followed these steps and are still experiencing problems, please:

1. Check the [Kilo Code GitHub Issues](https://github.com/Kilo-Org/kilocode/issues) to see if others have reported similar problems
2. If not, create a new issue with details about your operating system, VS Code/Cursor version, and the steps you've tried

For additional help, join our [Discord](https://kilo.ai/discord).

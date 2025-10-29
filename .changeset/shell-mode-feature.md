---
"@kilocode/cli": minor
---

Add shell mode feature with Shift+1 hotkey for interactive bash command execution.

## Features

- **Toggle shell mode** with `Shift+1` or `Shift+!`
- **Immediate command execution** without approval prompts
- **Command history navigation** with up/down arrows
- **Enhanced input box** with yellow border and "shell" indicator
- **Escape key support** to exit shell mode
- **Agent context integration** for AI awareness of shell commands
- **Cross-platform compatibility** with existing keyboard infrastructure

## Implementation Details

- Added shell mode to InputMode system
- Extended keyboard parsing for Shift+1 detection
- Enhanced CommandInput component with shell mode styling
- Integrated shell command output with chatMessagesAtom for AI context
- Updated hotkey display to show shell mode shortcuts
- Added comprehensive test coverage

## Usage

- Press `Shift+1` to toggle shell mode (input box turns yellow)
- Type bash commands and press Enter to execute
- Use ↑/↓ arrows to navigate command history
- Press Escape or `Shift+1` again to exit shell mode
- Command output is visible to the AI agent for context

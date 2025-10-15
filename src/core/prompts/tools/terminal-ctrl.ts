import { ToolArgs } from "./types"

export function getTerminalCtrlDescription(args: ToolArgs): string | undefined {
	return `## terminal_ctrl
Description: Manage running processes in terminals.

Parameters:
- action: (required) Must be "kill" - the only supported action
- terminal_id: (required) The terminal ID containing the process to kill

Usage example: Kill a process running in terminal 1
<terminal_ctrl>
<action>kill</action>
<terminal_id>1</terminal_id>
</terminal_ctrl>`
}

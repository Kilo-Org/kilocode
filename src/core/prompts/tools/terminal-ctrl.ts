// kilocode_change - new file: Terminal control tool prompt description
import { ToolArgs } from "./types"

export function getTerminalKillDescription(args: ToolArgs): string | undefined {
	return `## terminal_kill
Description: Manage running processes in terminals.

Parameters:
- terminal_id: (required) The terminal ID containing the process to kill

Usage example: Kill a process running in terminal 1
<terminal_kill>
<terminal_id>1</terminal_id>
</terminal_kill>`
}

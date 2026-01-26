/**
 * CLI-specific global slash commands
 *
 * These commands are handled entirely within the CLI and trigger actions
 * by sending messages to the extension host. They are separate from the
 * extension's built-in commands which expand into prompt content.
 */

/**
 * Action types that can be triggered by global commands.
 * Each action corresponds to a message type sent to the extension host.
 */
export type GlobalCommandAction = "clearTask"

/**
 * Definition of a CLI global command
 */
export interface GlobalCommand {
	/** Command name (without the leading /) */
	name: string
	/** Description shown in the autocomplete picker */
	description: string
	/** Action to trigger when the command is executed */
	action: GlobalCommandAction
}

/**
 * CLI-specific global slash commands
 * These commands trigger actions rather than expanding into prompt content.
 */
export const GLOBAL_COMMANDS: GlobalCommand[] = [
	{
		name: "new",
		description: "Start a new task",
		action: "clearTask",
	},
]

/**
 * Get a global command by name
 */
export function getGlobalCommand(name: string): GlobalCommand | undefined {
	return GLOBAL_COMMANDS.find((cmd) => cmd.name === name)
}

/**
 * Get global commands formatted for autocomplete
 * Returns commands in the SlashCommandResult format expected by the autocomplete trigger
 */
export function getGlobalCommandsForAutocomplete(): Array<{
	name: string
	description?: string
	source: "global" | "project" | "built-in"
	action?: string
}> {
	return GLOBAL_COMMANDS.map((cmd) => ({
		name: cmd.name,
		description: cmd.description,
		source: "global" as const,
		action: cmd.action,
	}))
}

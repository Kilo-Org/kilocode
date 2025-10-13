/**
 * Commands module - exports command system components
 */

export * from "./core/types.js"
export * from "./core/parser.js"
export * from "./core/registry.js"
import { commandRegistry } from "./core/registry.js"

import { helpCommand } from "./help.js"
import { newCommand } from "./new.js"
import { exitCommand } from "./exit.js"
import { modeCommand } from "./mode.js"
import { modelCommand } from "./model.js"

/**
 * Initialize all commands
 */
export function initializeCommands(): void {
	// Register all commands
	commandRegistry.register(helpCommand)
	commandRegistry.register(newCommand)
	commandRegistry.register(exitCommand)
	commandRegistry.register(modeCommand)
	commandRegistry.register(modelCommand)
}

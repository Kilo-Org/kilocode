/**
 * Commands module - exports command system components
 */

export * from "./core/types.js"
export * from "./core/parser.js"
export * from "./core/registry.js"
import { commandRegistry } from "./core/registry.js"

import { helpCommand } from "./help.js"
import { newCommand } from "./new.js"
import { clearCommand } from "./clear.js"
import { exitCommand } from "./exit.js"
import { modeCommand } from "./mode.js"
import { modelCommand } from "./model.js"
import { providerCommand } from "./provider.js"
import { profileCommand } from "./profile.js"
import { teamsCommand } from "./teams.js"
import { configCommand } from "./config.js"
import { tasksCommand } from "./tasks.js"
import { themeCommand } from "./theme.js"
import { checkpointCommand } from "./checkpoint.js"
import { sessionCommand } from "./session.js"
import { condenseCommand } from "./condense.js"

/**
 * Initialize all commands
 */
export function initializeCommands(): void {
	// Register all commands
	commandRegistry.register(helpCommand)
	commandRegistry.register(newCommand)
	commandRegistry.register(clearCommand)
	commandRegistry.register(exitCommand)
	commandRegistry.register(modeCommand)
	commandRegistry.register(modelCommand)
	commandRegistry.register(providerCommand)
	commandRegistry.register(profileCommand)
	commandRegistry.register(teamsCommand)
	commandRegistry.register(configCommand)
	commandRegistry.register(tasksCommand)
	commandRegistry.register(themeCommand)
	commandRegistry.register(checkpointCommand)
	commandRegistry.register(sessionCommand)
	commandRegistry.register(condenseCommand)
}

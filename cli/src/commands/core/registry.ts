/**
 * Command registry - manages all available commands
 */

import type { Command } from "./types.js"

class CommandRegistry {
	private commands: Map<string, Command> = new Map()
	private aliases: Map<string, string> = new Map()

	/**
	 * Register a new command
	 */
	register(command: Command): void {
		this.commands.set(command.name, command)

		// Register aliases
		for (const alias of command.aliases) {
			this.aliases.set(alias, command.name)
		}
	}

	/**
	 * Get a command by name or alias
	 */
	get(nameOrAlias: string): Command | undefined {
		// Try direct lookup
		const command = this.commands.get(nameOrAlias)
		if (command) {
			return command
		}

		// Try alias lookup
		const commandName = this.aliases.get(nameOrAlias)
		if (commandName) {
			return this.commands.get(commandName)
		}

		return undefined
	}

	/**
	 * Get all registered commands
	 */
	getAll(): Command[] {
		return Array.from(this.commands.values())
	}

	/**
	 * Get commands by category
	 */
	getByCategory(category: Command["category"]): Command[] {
		return this.getAll().filter((cmd) => cmd.category === category)
	}

	/**
	 * Search commands by query (fuzzy match on name and description)
	 */
	search(query: string): Command[] {
		const lowerQuery = query.toLowerCase()
		return this.getAll().filter((cmd) => {
			return (
				cmd.name.toLowerCase().includes(lowerQuery) ||
				cmd.description.toLowerCase().includes(lowerQuery) ||
				cmd.aliases.some((alias) => alias.toLowerCase().includes(lowerQuery))
			)
		})
	}

	/**
	 * Check if a command exists
	 */
	has(nameOrAlias: string): boolean {
		return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias)
	}

	/**
	 * Clear all commands
	 */
	clear(): void {
		this.commands.clear()
		this.aliases.clear()
	}
}

// Export singleton instance
export const commandRegistry = new CommandRegistry()

// Export class for testing
export { CommandRegistry }

// kilocode_change start
/**
 * Commands service - manages slash commands from .kilocode/commands/ directories
 * and built-in commands. Refactored to use markdown-resource-base module.
 */

import * as path from "path"
import { MarkdownResource, scanResourceDirectory, tryLoadResource } from "../markdown-resource-base"
import { getGlobalRooDirectory, getProjectRooDirectoryForCwd } from "../roo-config"
import { getBuiltInCommands, getBuiltInCommand } from "./built-in-commands"

// Type alias for clarity - Command is a MarkdownResource
export type Command = MarkdownResource

/**
 * Get all available commands (global + project + built-in)
 * Priority: project > global > built-in
 */
export async function getCommands(cwd: string): Promise<Command[]> {
	const commands = new Map<string, Command>()

	// Scan global commands first (lowest priority)
	const globalDir = path.join(getGlobalRooDirectory(), "commands")
	await scanResourceDirectory(globalDir, "global", commands)

	// Scan project commands (overrides global)
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	await scanResourceDirectory(projectDir, "project", commands)

	// Add built-in commands (can be overridden by user commands)
	for (const cmd of await getBuiltInCommands()) {
		if (!commands.has(cmd.name)) {
			commands.set(cmd.name, cmd)
		}
	}

	return Array.from(commands.values())
}

/**
 * Get a specific command by name (optimized lookup)
 * Priority: project > global > built-in
 */
export async function getCommand(cwd: string, name: string): Promise<Command | undefined> {
	// Try project first
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	const projectCommand = await tryLoadResource(projectDir, name, "project")
	if (projectCommand) return projectCommand

	// Try global
	const globalDir = path.join(getGlobalRooDirectory(), "commands")
	const globalCommand = await tryLoadResource(globalDir, name, "global")
	if (globalCommand) return globalCommand

	// Try built-in
	return await getBuiltInCommand(name)
}

/**
 * Get command names for autocomplete
 */
export async function getCommandNames(cwd: string): Promise<string[]> {
	const commands = await getCommands(cwd)
	return commands.map((cmd) => cmd.name)
}
// kilocode_change end

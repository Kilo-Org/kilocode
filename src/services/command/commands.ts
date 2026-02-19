import fs from "fs/promises"
import * as path from "path"
import { Dirent } from "fs"
import matter from "gray-matter"
import { getGlobalRooDirectory, getProjectRooDirectoryForCwd } from "../roo-config"
import { getBuiltInCommands, getBuiltInCommand } from "./built-in-commands"
// kilocode_change start
import { ClineRulesToggles } from "../../shared/cline-rules"
// kilocode_change end

/**
 * Maximum depth for resolving symlinks to prevent cyclic symlink loops
 */
const MAX_DEPTH = 5

export interface Command {
	name: string
	content: string
	source: "global" | "project" | "built-in"
	filePath: string
	description?: string
	argumentHint?: string
	mode?: string
}

/**
 * Information about a resolved command file
 */
interface CommandFileInfo {
	/** Original path (symlink path if symlinked, otherwise the file path) */
	originalPath: string
	/** Resolved path (target of symlink if symlinked, otherwise the file path) */
	resolvedPath: string
}

/**
 * Recursively resolve a symbolic link and collect command file info
 */
async function resolveCommandSymLink(symlinkPath: string, fileInfo: CommandFileInfo[], depth: number): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}
	try {
		// Get the symlink target
		const linkTarget = await fs.readlink(symlinkPath)
		// Resolve the target path (relative to the symlink location)
		const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget)

		// Check if the target is a file (use lstat to detect nested symlinks)
		const stats = await fs.lstat(resolvedTarget)
		if (stats.isFile()) {
			// Only include markdown files
			if (isMarkdownFile(resolvedTarget)) {
				// For symlinks to files, store the symlink path as original and target as resolved
				fileInfo.push({ originalPath: symlinkPath, resolvedPath: resolvedTarget })
			}
		} else if (stats.isDirectory()) {
			// Read the target directory and process its entries
			const entries = await fs.readdir(resolvedTarget, { withFileTypes: true })
			const directoryPromises: Promise<void>[] = []
			for (const entry of entries) {
				directoryPromises.push(resolveCommandDirectoryEntry(entry, resolvedTarget, fileInfo, depth + 1))
			}
			await Promise.all(directoryPromises)
		} else if (stats.isSymbolicLink()) {
			// Handle nested symlinks
			await resolveCommandSymLink(resolvedTarget, fileInfo, depth + 1)
		}
	} catch {
		// Skip invalid symlinks
	}
}

/**
 * Recursively resolve directory entries and collect command file paths
 */
async function resolveCommandDirectoryEntry(
	entry: Dirent,
	dirPath: string,
	fileInfo: CommandFileInfo[],
	depth: number,
): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}

	const fullPath = path.resolve(entry.parentPath || dirPath, entry.name)
	if (entry.isFile()) {
		// Only include markdown files
		if (isMarkdownFile(entry.name)) {
			// Regular file - both original and resolved paths are the same
			fileInfo.push({ originalPath: fullPath, resolvedPath: fullPath })
		}
	} else if (entry.isSymbolicLink()) {
		// Await the resolution of the symbolic link
		await resolveCommandSymLink(fullPath, fileInfo, depth + 1)
	}
}

/**
 * Try to resolve a symlinked command file
 */
async function tryResolveSymlinkedCommand(filePath: string): Promise<string | undefined> {
	try {
		const lstat = await fs.lstat(filePath)
		if (lstat.isSymbolicLink()) {
			// Get the symlink target
			const linkTarget = await fs.readlink(filePath)
			// Resolve the target path (relative to the symlink location)
			const resolvedTarget = path.resolve(path.dirname(filePath), linkTarget)

			// Check if the target is a file
			const stats = await fs.stat(resolvedTarget)
			if (stats.isFile()) {
				return resolvedTarget
			}
		}
	} catch {
		// Not a symlink or invalid symlink
	}
	return undefined
}

/**
 * Get all available commands from built-in, global, and project directories
 * Priority order: project > global > built-in (later sources override earlier ones)
 * Workflows are filtered by toggle state when options are provided
 */
export async function getCommands(cwd: string, options?: GetCommandOptions): Promise<Command[]> {
	const commands = new Map<string, Command>()

	// Add built-in commands first (lowest priority)
	const builtInCommands = await getBuiltInCommands()
	for (const command of builtInCommands) {
		commands.set(command.name, command)
	}

	// Scan global commands (override built-in)
	const globalDir = path.join(getGlobalRooDirectory(), "commands")
	await scanCommandDirectory(globalDir, "global", commands)

	// kilocode_change start
	// Also scan global workflows
	const globalWorkflowsDir = path.join(getGlobalRooDirectory(), "workflows")
	await scanCommandDirectory(globalWorkflowsDir, "global", commands)
	// kilocode_change end

	// Scan project commands (highest priority - override both global and built-in)
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	await scanCommandDirectory(projectDir, "project", commands)

	// kilocode_change start
	// Also scan project workflows
	const projectWorkflowsDir = path.join(getProjectRooDirectoryForCwd(cwd), "workflows")
	await scanCommandDirectory(projectWorkflowsDir, "project", commands)
	// kilocode_change end

	// kilocode_change start
	// Filter out disabled workflows if options are provided
	if (options) {
		const filteredCommands = Array.from(commands.values()).filter((cmd) => {
			// Built-in commands are always enabled
			if (cmd.source === "built-in") return true
			// Apply toggle filtering for global and project sources
			if (cmd.source === "global" || cmd.source === "project") {
				return isEnabled(cmd.filePath, cmd.source, options)
			}
			// Unknown source types are included by default
			return true
		})
		return filteredCommands
	}
	// kilocode_change end

	return Array.from(commands.values())
}

// kilocode_change start
/**
 * Options for getting commands with toggle filtering
 */
export interface GetCommandOptions {
	localToggles?: ClineRulesToggles
	globalToggles?: ClineRulesToggles
}

/**
 * Check if a workflow/command is enabled based on toggle state
 * Commands (non-workflows) are always enabled since they have no toggle concept
 */
function isEnabled(filePath: string, source: "global" | "project", options?: GetCommandOptions): boolean {
	if (!options) return true
	const toggles = source === "project" ? options.localToggles : options.globalToggles
	if (!toggles) return true
	return toggles[filePath] !== false // enabled by default if not set
}
// kilocode_change end

/**
 * Get a specific command by name (optimized to avoid scanning all commands)
 * Priority order: project > global > built-in
 * Project workflows have higher priority than global commands
 */
// kilocode_change start
export async function getCommand(cwd: string, name: string, options?: GetCommandOptions): Promise<Command | undefined> {
	// kilocode_change end
	// Try to find the command directly without scanning all commands
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	const globalDir = path.join(getGlobalRooDirectory(), "commands")

	// kilocode_change start
	// Also check workflow directories
	const projectWorkflowsDir = path.join(getProjectRooDirectoryForCwd(cwd), "workflows")
	const globalWorkflowsDir = path.join(getGlobalRooDirectory(), "workflows")

	// Check project commands first (highest priority)
	const projectCommand = await tryLoadCommand(projectDir, name, "project")
	if (projectCommand) {
		return projectCommand
	}

	// Check project workflows (if enabled by toggle) - project workflows override global commands
	const projectWorkflow = await tryLoadCommand(projectWorkflowsDir, name, "project")
	if (projectWorkflow && isEnabled(projectWorkflow.filePath, "project", options)) {
		return projectWorkflow
	}

	// Check global commands (after project workflows to respect project > global priority)
	const globalCommand = await tryLoadCommand(globalDir, name, "global")
	if (globalCommand) {
		return globalCommand
	}

	// Check global workflows (if enabled by toggle)
	const globalWorkflow = await tryLoadCommand(globalWorkflowsDir, name, "global")
	if (globalWorkflow && isEnabled(globalWorkflow.filePath, "global", options)) {
		return globalWorkflow
	}
	// kilocode_change end

	// Check built-in commands if not found in project or global (lowest priority)
	return await getBuiltInCommand(name)
}

/**
 * Try to load a specific command from a directory (supports symlinks)
 */
async function tryLoadCommand(
	dirPath: string,
	name: string,
	source: "global" | "project",
): Promise<Command | undefined> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return undefined
		}

		// Try to find the command file directly
		const commandFileName = `${name}.md`
		const filePath = path.join(dirPath, commandFileName)

		// Check if this is a regular file first
		let resolvedPath = filePath
		let content: string | undefined

		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch {
			// File doesn't exist or can't be read - try resolving as symlink
			const symlinkedPath = await tryResolveSymlinkedCommand(filePath)
			if (symlinkedPath) {
				try {
					content = await fs.readFile(symlinkedPath, "utf-8")
					resolvedPath = symlinkedPath
				} catch {
					// Symlink target can't be read
					return undefined
				}
			} else {
				return undefined
			}
		}

		if (!content) {
			return undefined
		}

		let parsed
		let description: string | undefined
		let argumentHint: string | undefined
		let mode: string | undefined
		let commandContent: string

		try {
			// Try to parse frontmatter with gray-matter
			parsed = matter(content)
			description =
				typeof parsed.data.description === "string" && parsed.data.description.trim()
					? parsed.data.description.trim()
					: undefined
			argumentHint =
				typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
					? parsed.data["argument-hint"].trim()
					: undefined
			mode = typeof parsed.data.mode === "string" && parsed.data.mode.trim() ? parsed.data.mode.trim() : undefined
			commandContent = parsed.content.trim()
		} catch {
			// If frontmatter parsing fails, treat the entire content as command content
			description = undefined
			argumentHint = undefined
			mode = undefined
			commandContent = content.trim()
		}

		return {
			name,
			content: commandContent,
			source,
			filePath: resolvedPath,
			description,
			argumentHint,
			mode,
		}
	} catch {
		// Directory doesn't exist or can't be read
		return undefined
	}
}

/**
 * Get command names for autocomplete
 */
export async function getCommandNames(cwd: string): Promise<string[]> {
	const commands = await getCommands(cwd)
	return commands.map((cmd) => cmd.name)
}

/**
 * Scan a specific command directory (supports symlinks)
 */
async function scanCommandDirectory(
	dirPath: string,
	source: "global" | "project",
	commands: Map<string, Command>,
): Promise<void> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return
		}

		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		// Collect all command files, including those from symlinks
		const fileInfo: CommandFileInfo[] = []
		const initialPromises: Promise<void>[] = []

		for (const entry of entries) {
			initialPromises.push(resolveCommandDirectoryEntry(entry, dirPath, fileInfo, 0))
		}

		// Wait for all files to be resolved
		await Promise.all(initialPromises)

		// Process each collected file
		for (const { originalPath, resolvedPath } of fileInfo) {
			// Command name comes from the original path (symlink name if symlinked)
			const commandName = getCommandNameFromFile(path.basename(originalPath))

			try {
				const content = await fs.readFile(resolvedPath, "utf-8")

				let parsed
				let description: string | undefined
				let argumentHint: string | undefined
				let mode: string | undefined
				let commandContent: string

				try {
					// Try to parse frontmatter with gray-matter
					parsed = matter(content)
					description =
						typeof parsed.data.description === "string" && parsed.data.description.trim()
							? parsed.data.description.trim()
							: undefined
					argumentHint =
						typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
							? parsed.data["argument-hint"].trim()
							: undefined
					mode =
						typeof parsed.data.mode === "string" && parsed.data.mode.trim()
							? parsed.data.mode.trim()
							: undefined
					commandContent = parsed.content.trim()
				} catch {
					// If frontmatter parsing fails, treat the entire content as command content
					description = undefined
					argumentHint = undefined
					mode = undefined
					commandContent = content.trim()
				}

				// Project commands override global ones
				if (source === "project" || !commands.has(commandName)) {
					commands.set(commandName, {
						name: commandName,
						content: commandContent,
						source,
						filePath: resolvedPath,
						description,
						argumentHint,
						mode,
					})
				}
			} catch (error) {
				console.warn(`Failed to read command file ${resolvedPath}:`, error)
			}
		}
	} catch {
		// Directory doesn't exist or can't be read - this is fine
	}
}

/**
 * Extract command name from filename (strip .md extension only)
 */
export function getCommandNameFromFile(filename: string): string {
	if (filename.toLowerCase().endsWith(".md")) {
		return filename.slice(0, -3)
	}
	return filename
}

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
	return filename.toLowerCase().endsWith(".md")
}

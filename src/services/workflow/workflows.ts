// kilocode_change - new file

import fs from "fs/promises"
import * as path from "path"
import { Dirent } from "fs"
import matter from "gray-matter"

/**
 * Maximum depth for resolving symlinks to prevent cyclic symlink loops
 */
const MAX_DEPTH = 5

export interface Workflow {
	name: string
	content: string
	source: "project" | "global"
	filePath: string
	description?: string
	arguments?: string
}

/**
 * Information about a resolved workflow file
 */
interface WorkflowFileInfo {
	/** Original path (symlink path if symlinked, otherwise the file path) */
	originalPath: string
	/** Resolved path (target of symlink if symlinked, otherwise the file path) */
	resolvedPath: string
}

/**
 * Recursively resolve a symbolic link and collect workflow file info
 */
async function resolveWorkflowSymLink(symlinkPath: string, fileInfo: WorkflowFileInfo[], depth: number): Promise<void> {
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
				directoryPromises.push(resolveWorkflowDirectoryEntry(entry, resolvedTarget, fileInfo, depth + 1))
			}
			await Promise.all(directoryPromises)
		} else if (stats.isSymbolicLink()) {
			// Handle nested symlinks
			await resolveWorkflowSymLink(resolvedTarget, fileInfo, depth + 1)
		}
	} catch {
		// Skip invalid symlinks
	}
}

/**
 * Recursively resolve directory entries and collect workflow file paths
 */
async function resolveWorkflowDirectoryEntry(
	entry: Dirent,
	dirPath: string,
	fileInfo: WorkflowFileInfo[],
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
		await resolveWorkflowSymLink(fullPath, fileInfo, depth + 1)
	}
}

/**
 * Try to resolve a symlinked workflow file
 */
async function tryResolveSymlinkedWorkflow(filePath: string): Promise<string | undefined> {
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
 * Get all available workflows from global and project directories
 * Priority order: project > global (later sources override earlier ones)
 */
export async function getWorkflows(cwd: string): Promise<Workflow[]> {
	const workflows = new Map<string, Workflow>()

	// Scan global workflows first (lower priority)
	const globalDir = path.join(getGlobalKiloCodeDirectory(), "workflows")
	await scanWorkflowDirectory(globalDir, "global", workflows)

	// Scan project workflows (higher priority - override global)
	const projectDir = path.join(getProjectKiloCodeDirectoryForCwd(cwd), "workflows")
	await scanWorkflowDirectory(projectDir, "project", workflows)

	return Array.from(workflows.values())
}

/**
 * Get a specific workflow by name (optimized to avoid scanning all workflows)
 * Priority order: project > global
 */
export async function getWorkflow(cwd: string, name: string): Promise<Workflow | undefined> {
	// Try to find the workflow directly without scanning all workflows
	const projectDir = path.join(getProjectKiloCodeDirectoryForCwd(cwd), "workflows")
	const globalDir = path.join(getGlobalKiloCodeDirectory(), "workflows")

	// Check project directory first (highest priority)
	const projectWorkflow = await tryLoadWorkflow(projectDir, name, "project")
	if (projectWorkflow) {
		return projectWorkflow
	}

	// Check global directory if not found in project
	return await tryLoadWorkflow(globalDir, name, "global")
}

/**
 * Try to load a specific workflow from a directory (supports symlinks)
 */
async function tryLoadWorkflow(
	dirPath: string,
	name: string,
	source: "global" | "project",
): Promise<Workflow | undefined> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return undefined
		}

		// Try to find the workflow file directly
		const workflowFileName = `${name}.md`
		const filePath = path.join(dirPath, workflowFileName)

		// Check if this is a regular file first
		let resolvedPath = filePath
		let content: string | undefined

		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch {
			// File doesn't exist or can't be read - try resolving as symlink
			const symlinkedPath = await tryResolveSymlinkedWorkflow(filePath)
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
		let argumentsHint: string | undefined
		let workflowContent: string

		try {
			// Try to parse frontmatter with gray-matter
			parsed = matter(content)
			description =
				typeof parsed.data.description === "string" && parsed.data.description.trim()
					? parsed.data.description.trim()
					: undefined
			argumentsHint =
				typeof parsed.data.arguments === "string" && parsed.data.arguments.trim()
					? parsed.data.arguments.trim()
					: undefined
			workflowContent = parsed.content.trim()
		} catch {
			// If frontmatter parsing fails, treat the entire content as workflow content
			description = undefined
			argumentsHint = undefined
			workflowContent = content.trim()
		}

		return {
			name,
			content: workflowContent,
			source,
			filePath: resolvedPath,
			description,
			arguments: argumentsHint,
		}
	} catch {
		// Directory doesn't exist or can't be read
		return undefined
	}
}

/**
 * Get workflow names for autocomplete
 */
export async function getWorkflowNames(cwd: string): Promise<string[]> {
	const workflows = await getWorkflows(cwd)
	return workflows.map((workflow) => workflow.name)
}

/**
 * Scan a specific workflow directory (supports symlinks)
 */
async function scanWorkflowDirectory(
	dirPath: string,
	source: "global" | "project",
	workflows: Map<string, Workflow>,
): Promise<void> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return
		}

		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		// Collect all workflow files, including those from symlinks
		const fileInfo: WorkflowFileInfo[] = []
		const initialPromises: Promise<void>[] = []

		for (const entry of entries) {
			initialPromises.push(resolveWorkflowDirectoryEntry(entry, dirPath, fileInfo, 0))
		}

		// Wait for all files to be resolved
		await Promise.all(initialPromises)

		// Process each collected file
		for (const { originalPath, resolvedPath } of fileInfo) {
			// Workflow name comes from the original path (symlink name if symlinked)
			const workflowName = getWorkflowNameFromFile(path.basename(originalPath))

			try {
				const content = await fs.readFile(resolvedPath, "utf-8")

				let parsed
				let description: string | undefined
				let argumentsHint: string | undefined
				let workflowContent: string

				try {
					// Try to parse frontmatter with gray-matter
					parsed = matter(content)
					description =
						typeof parsed.data.description === "string" && parsed.data.description.trim()
							? parsed.data.description.trim()
							: undefined
					argumentsHint =
						typeof parsed.data.arguments === "string" && parsed.data.arguments.trim()
							? parsed.data.arguments.trim()
							: undefined
					workflowContent = parsed.content.trim()
				} catch {
					// If frontmatter parsing fails, treat the entire content as workflow content
					description = undefined
					argumentsHint = undefined
					workflowContent = content.trim()
				}

				// Project workflows override global ones
				if (source === "project" || !workflows.has(workflowName)) {
					workflows.set(workflowName, {
						name: workflowName,
						content: workflowContent,
						source,
						filePath: resolvedPath,
						description,
						arguments: argumentsHint,
					})
				}
			} catch (error) {
				console.warn(`Failed to read workflow file ${resolvedPath}:`, error)
			}
		}
	} catch {
		// Directory doesn't exist or can't be read - this is fine
	}
}

/**
 * Extract workflow name from filename (strip .md extension only)
 */
export function getWorkflowNameFromFile(filename: string): string {
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

/**
 * Get the global Kilo Code directory path
 */
function getGlobalKiloCodeDirectory(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	return path.join(homeDir, ".kilocode")
}

/**
 * Get the project-level Kilo Code directory path for a given working directory
 */
function getProjectKiloCodeDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".kilocode")
}

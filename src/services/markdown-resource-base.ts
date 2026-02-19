// kilocode_change - new file

/**
 * Base module for markdown-based resource discovery (commands, workflows, etc.)
 * Extracts common symlink resolution, directory scanning, and frontmatter parsing.
 */

import fs from "fs/promises"
import * as path from "path"
import { Dirent } from "fs"
import matter from "gray-matter"

/**
 * Maximum depth for resolving symlinks to prevent cyclic loops
 */
export const MAX_DEPTH = 5

/**
 * Base interface for markdown resources (commands, workflows)
 */
export interface MarkdownResource {
	name: string
	content: string
	source: "global" | "project" | "built-in"
	filePath: string
	description?: string
	arguments?: string
	argumentHint?: string
	mode?: string
}

/**
 * Information about a resolved file (handles symlinks)
 */
export interface ResourceFileInfo {
	/** Original path (symlink path if symlinked, otherwise the file path) */
	originalPath: string
	/** Resolved path (target of symlink if symlinked, otherwise the file path) */
	resolvedPath: string
}

/**
 * Parsed frontmatter result
 */
export interface ParsedFrontmatter {
	content: string
	description?: string
	arguments?: string
	argumentHint?: string
	mode?: string
}

/**
 * Recursively resolve a symbolic link and collect file info
 */
export async function resolveSymlink(
	symlinkPath: string,
	fileInfo: ResourceFileInfo[],
	depth: number = 0,
): Promise<void> {
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
			await Promise.all(entries.map((entry) => resolveDirectoryEntry(entry, resolvedTarget, fileInfo, depth + 1)))
		} else if (stats.isSymbolicLink()) {
			// Handle nested symlinks
			await resolveSymlink(resolvedTarget, fileInfo, depth + 1)
		}
	} catch {
		// Skip invalid symlinks
	}
}

/**
 * Process a directory entry (file or symlink)
 */
export async function resolveDirectoryEntry(
	entry: Dirent,
	dirPath: string,
	fileInfo: ResourceFileInfo[],
	depth: number = 0,
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
		await resolveSymlink(fullPath, fileInfo, depth + 1)
	}
}

/**
 * Try to resolve a symlinked file path
 */
export async function tryResolveSymlink(filePath: string): Promise<string | undefined> {
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
 * Parse frontmatter from markdown content
 * Handles both 'arguments' (workflows) and 'argument-hint' (commands) fields
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
	try {
		// Try to parse frontmatter with gray-matter
		const parsed = matter(content)
		return {
			content: parsed.content.trim(),
			description:
				typeof parsed.data.description === "string" && parsed.data.description.trim()
					? parsed.data.description.trim()
					: undefined,
			arguments:
				typeof parsed.data.arguments === "string" && parsed.data.arguments.trim()
					? parsed.data.arguments.trim()
					: undefined,
			argumentHint:
				typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
					? parsed.data["argument-hint"].trim()
					: undefined,
			mode: typeof parsed.data.mode === "string" && parsed.data.mode.trim() ? parsed.data.mode.trim() : undefined,
		}
	} catch {
		// If frontmatter parsing fails, treat the entire content as resource content
		return { content: content.trim() }
	}
}

/**
 * Scan a directory for markdown resources
 */
export async function scanResourceDirectory(
	dirPath: string,
	source: "global" | "project",
	resources: Map<string, MarkdownResource>,
): Promise<void> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return
		}

		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		// Collect all resource files, including those from symlinks
		const fileInfo: ResourceFileInfo[] = []
		await Promise.all(entries.map((entry) => resolveDirectoryEntry(entry, dirPath, fileInfo, 0)))

		// Process each collected file
		for (const { originalPath, resolvedPath } of fileInfo) {
			// Resource name comes from the original path (symlink name if symlinked)
			const resourceName = getResourceNameFromFile(path.basename(originalPath))

			try {
				const content = await fs.readFile(resolvedPath, "utf-8")
				const parsed = parseFrontmatter(content)

				// Project resources override global ones
				if (source === "project" || !resources.has(resourceName)) {
					resources.set(resourceName, {
						name: resourceName,
						content: parsed.content,
						source,
						filePath: resolvedPath,
						description: parsed.description,
						arguments: parsed.arguments,
						argumentHint: parsed.argumentHint,
						mode: parsed.mode,
					})
				}
			} catch (error) {
				console.warn(`Failed to read resource file ${resolvedPath}:`, error)
			}
		}
	} catch {
		// Directory doesn't exist or can't be read - this is fine
	}
}

/**
 * Try to load a specific resource by name (optimized)
 */
export async function tryLoadResource(
	dirPath: string,
	name: string,
	source: "global" | "project",
): Promise<MarkdownResource | undefined> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return undefined
		}

		// Try to find the resource file directly
		const fileName = `${name}.md`
		const filePath = path.join(dirPath, fileName)

		// Check if this is a regular file first
		let resolvedPath = filePath
		let content: string | undefined

		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch {
			// File doesn't exist or can't be read - try resolving as symlink
			const symlinkedPath = await tryResolveSymlink(filePath)
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

		const parsed = parseFrontmatter(content)

		return {
			name,
			content: parsed.content,
			source,
			filePath: resolvedPath,
			description: parsed.description,
			arguments: parsed.arguments,
			argumentHint: parsed.argumentHint,
			mode: parsed.mode,
		}
	} catch {
		// Directory doesn't exist or can't be read
		return undefined
	}
}

/**
 * Extract resource name from filename (strip .md extension)
 */
export function getResourceNameFromFile(filename: string): string {
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

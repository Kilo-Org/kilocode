// kilocode_change - new file

import fs from "fs/promises"
import * as path from "path"
import { Dirent } from "fs"
import type { DiscoveredWorkflow } from "./types"
import { WorkflowMetadataExtractor } from "./WorkflowMetadataExtractor"

/**
 * Maximum depth for resolving symlinks to prevent cyclic symlink loops
 */
const MAX_DEPTH = 5

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
 * Scans workflow directories and discovers workflow files
 */
export class WorkflowScanner {
	private metadataExtractor: WorkflowMetadataExtractor

	constructor() {
		this.metadataExtractor = new WorkflowMetadataExtractor()
	}

	/**
	 * Scan global workflow directory
	 * @param globalDir - Path to global workflows directory
	 * @returns Array of discovered global workflows
	 */
	async scanGlobalWorkflows(globalDir: string): Promise<DiscoveredWorkflow[]> {
		return this.scanDirectory(globalDir, "global")
	}

	/**
	 * Scan workspace workflow directory
	 * @param workspaceDir - Path to workspace workflows directory
	 * @returns Array of discovered workspace workflows
	 */
	async scanWorkspaceWorkflows(workspaceDir: string): Promise<DiscoveredWorkflow[]> {
		return this.scanDirectory(workspaceDir, "workspace")
	}

	/**
	 * Scan a workflow directory for markdown files
	 * @param dirPath - Path to directory to scan
	 * @param source - Source type (global or workspace)
	 * @returns Array of discovered workflows
	 */
	private async scanDirectory(dirPath: string, source: "global" | "workspace"): Promise<DiscoveredWorkflow[]> {
		const workflows: DiscoveredWorkflow[] = []

		try {
			const stats = await fs.stat(dirPath)
			if (!stats.isDirectory()) {
				return workflows
			}

			const entries = await fs.readdir(dirPath, { withFileTypes: true })

			// Collect all workflow files, including those from symlinks
			const fileInfo: WorkflowFileInfo[] = []
			const promises: Promise<void>[] = []

			for (const entry of entries) {
				promises.push(this.resolveDirectoryEntry(entry, dirPath, fileInfo, 0))
			}

			await Promise.all(promises)

			// Process each collected file
			for (const { originalPath, resolvedPath } of fileInfo) {
				const workflow = await this.createWorkflowFromFile(resolvedPath, originalPath, source)
				if (workflow) {
					workflows.push(workflow)
				}
			}
		} catch {
			// Directory doesn't exist or can't be read - this is fine
		}

		return workflows
	}

	/**
	 * Resolve a directory entry and collect workflow file info
	 * @param entry - Directory entry
	 * @param dirPath - Parent directory path
	 * @param fileInfo - Array to collect file info
	 * @param depth - Current depth for symlink resolution
	 */
	private async resolveDirectoryEntry(
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
			if (this.isMarkdownFile(entry.name)) {
				// Regular file - both original and resolved paths are the same
				fileInfo.push({ originalPath: fullPath, resolvedPath: fullPath })
			}
		} else if (entry.isSymbolicLink()) {
			// Resolve the symbolic link
			await this.resolveSymlink(fullPath, fileInfo, depth + 1)
		}
	}

	/**
	 * Resolve a symbolic link and collect workflow file info
	 * @param symlinkPath - Path to symlink
	 * @param fileInfo - Array to collect file info
	 * @param depth - Current depth for symlink resolution
	 */
	private async resolveSymlink(symlinkPath: string, fileInfo: WorkflowFileInfo[], depth: number): Promise<void> {
		// Avoid cyclic symlinks
		if (depth > MAX_DEPTH) {
			return
		}

		try {
			// Get the symlink target
			const linkTarget = await fs.readlink(symlinkPath)
			// Resolve the target path (relative to the symlink location)
			const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget)

			// Check if the target is a file
			const stats = await fs.lstat(resolvedTarget)
			if (stats.isFile()) {
				// Only include markdown files
				if (this.isMarkdownFile(resolvedTarget)) {
					// For symlinks to files, store the symlink path as original and target as resolved
					fileInfo.push({ originalPath: symlinkPath, resolvedPath: resolvedTarget })
				}
			} else if (stats.isDirectory()) {
				// Read the target directory and process its entries
				const entries = await fs.readdir(resolvedTarget, { withFileTypes: true })
				const promises: Promise<void>[] = []

				for (const entry of entries) {
					promises.push(this.resolveDirectoryEntry(entry, resolvedTarget, fileInfo, depth + 1))
				}

				await Promise.all(promises)
			} else if (stats.isSymbolicLink()) {
				// Handle nested symlinks
				await this.resolveSymlink(resolvedTarget, fileInfo, depth + 1)
			}
		} catch {
			// Skip invalid symlinks
		}
	}

	/**
	 * Create a discovered workflow object from a file
	 * @param filePath - Path to workflow file
	 * @param originalPath - Original path (for symlinks)
	 * @param source - Source type
	 * @returns Discovered workflow or undefined if file cannot be read
	 */
	private async createWorkflowFromFile(
		filePath: string,
		originalPath: string,
		source: "global" | "workspace",
	): Promise<DiscoveredWorkflow | undefined> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			const metadata = this.metadataExtractor.extractMetadata(content)

			// Extract workflow name from filename (strip .md extension)
			const filename = path.basename(originalPath)
			const name = this.getWorkflowNameFromFile(filename)

			return {
				name,
				commandName: `/${name}`,
				description: metadata.description,
				arguments: metadata.arguments,
				filePath,
				source,
				enabled: true, // Default to enabled, will be updated by workflow toggles
			}
		} catch (error) {
			console.warn(`Failed to read workflow file ${filePath}:`, error)
			return undefined
		}
	}

	/**
	 * Extract workflow name from filename (strip .md extension only)
	 * @param filename - Filename with or without extension
	 * @returns Workflow name
	 */
	private getWorkflowNameFromFile(filename: string): string {
		if (filename.toLowerCase().endsWith(".md")) {
			return filename.slice(0, -3)
		}
		return filename
	}

	/**
	 * Check if a file is a markdown file
	 * @param filename - Filename to check
	 * @returns True if file has .md extension
	 */
	private isMarkdownFile(filename: string): boolean {
		return filename.toLowerCase().endsWith(".md")
	}
}

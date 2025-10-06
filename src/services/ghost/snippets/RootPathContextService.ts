/**
 * Root Path Context Service
 * Simplified version of Continue's RootPathContextService.ts for workspace context
 */

import * as vscode from "vscode"
import { GhostCodeSnippet, GhostSnippetType } from "./types"

/**
 * Simple LRU cache for context snippets
 */
class ContextCache<K, V> {
	private cache = new Map<K, V>()
	private maxSize = 100

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			if (firstKey !== undefined) {
				this.cache.delete(firstKey)
			}
		}
		this.cache.set(key, value)
	}

	get(key: K): V | undefined {
		const value = this.cache.get(key)
		if (value !== undefined) {
			// Move to end (most recent)
			this.cache.delete(key)
			this.cache.set(key, value)
		}
		return value
	}
}

/**
 * Service for getting context from the project root path
 */
export class RootPathContextService {
	private cache = new ContextCache<string, GhostCodeSnippet[]>()

	constructor() {
		// Clear cache when files change
		vscode.workspace.onDidChangeTextDocument((event) => {
			// Invalidate cache entries related to changed file
			const changedFile = event.document.uri.fsPath
			this.cache.set(changedFile, []) // Clear specific file cache
		})
	}

	/**
	 * Get context snippets for a file path
	 */
	async getContextForPath(currentFilePath: string, _treePath?: any): Promise<GhostCodeSnippet[]> {
		// Check cache first
		const cached = this.cache.get(currentFilePath)
		if (cached) {
			return cached
		}

		try {
			const snippets = await this.collectRootPathSnippets(currentFilePath)
			this.cache.set(currentFilePath, snippets)
			return snippets
		} catch (error) {
			console.warn("Failed to get root path context:", error)
			return []
		}
	}

	/**
	 * Collect snippets from files in the workspace root and nearby directories
	 */
	private async collectRootPathSnippets(currentFilePath: string): Promise<GhostCodeSnippet[]> {
		const snippets: GhostCodeSnippet[] = []

		try {
			// Get workspace folders
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return snippets
			}

			const currentUri = vscode.Uri.file(currentFilePath)
			const workspaceRoot = workspaceFolders[0].uri

			// Get files from the same directory
			const currentDir = vscode.Uri.joinPath(currentUri, "..")
			await this.collectSnippetsFromDirectory(currentDir, snippets, currentFilePath, 5)

			// Get files from common directories (src, lib, etc.)
			const commonDirs = ["src", "lib", "utils", "components", "services"]
			for (const dirName of commonDirs) {
				try {
					const dirUri = vscode.Uri.joinPath(workspaceRoot, dirName)
					await this.collectSnippetsFromDirectory(dirUri, snippets, currentFilePath, 3)
				} catch (error) {
					// Directory doesn't exist, skip
				}
			}
		} catch (error) {
			console.warn("Error collecting root path snippets:", error)
		}

		return snippets.slice(0, 10) // Limit total snippets
	}

	/**
	 * Collect snippets from a specific directory
	 */
	private async collectSnippetsFromDirectory(
		dirUri: vscode.Uri,
		snippets: GhostCodeSnippet[],
		currentFilePath: string,
		maxFiles: number,
	): Promise<void> {
		try {
			const files = await vscode.workspace.fs.readDirectory(dirUri)

			const relevantFiles = files
				.filter(
					([name, type]) =>
						type === vscode.FileType.File &&
						this.isRelevantFile(name) &&
						vscode.Uri.joinPath(dirUri, name).fsPath !== currentFilePath,
				)
				.slice(0, maxFiles)

			for (const [fileName] of relevantFiles) {
				try {
					const fileUri = vscode.Uri.joinPath(dirUri, fileName)
					const content = await vscode.workspace.fs.readFile(fileUri)
					const textContent = Buffer.from(content).toString("utf8")

					if (textContent && textContent.trim() !== "") {
						// Get first 30 lines for context
						const contentLines = textContent.split("\n").slice(0, 30).join("\n")

						snippets.push({
							filepath: fileUri.fsPath,
							content: contentLines,
							type: GhostSnippetType.Code,
						})
					}
				} catch (error) {
					// Skip unreadable files
				}
			}
		} catch (error) {
			// Directory doesn't exist or can't be read
		}
	}

	/**
	 * Check if a file is relevant for context (based on extension)
	 */
	private isRelevantFile(fileName: string): boolean {
		const relevantExtensions = [
			".ts",
			".js",
			".tsx",
			".jsx",
			".py",
			".java",
			".cpp",
			".c",
			".h",
			".go",
			".rs",
			".rb",
			".php",
			".swift",
			".kt",
			".scala",
		]

		return relevantExtensions.some((ext) => fileName.endsWith(ext))
	}
}

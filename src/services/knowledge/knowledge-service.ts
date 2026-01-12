// kilocode_change - new file

/**
 * Enhanced Knowledge Service with Citation Tracking
 * Extends the knowledge base system to support source citations for AI responses
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { Citation, CompletionContext } from "../chat/types"
import { getCitationService } from "../chat/citation-service"

export interface KnowledgeServiceConfig {
	/** Maximum file size to index (in bytes) */
	maxFileSize?: number
	/** File extensions to index */
	fileExtensions?: string[]
	/** Directories to exclude */
	excludeDirectories?: string[]
	/** Enable citation tracking */
	enableCitationTracking?: boolean
}

export interface IndexedFile {
	path: string
	content: string
	embeddings?: number[]
	metadata: {
		size: number
		lines: number
		language: string
		lastModified: Date
	}
}

export interface SearchResult {
	file: IndexedFile
	score: number
	matches: Array<{
		line: number
		snippet: string
		context: string
	}>
}

export class KnowledgeService {
	private config: Required<KnowledgeServiceConfig>
	private citationService = getCitationService()
	private indexedFiles: Map<string, IndexedFile> = new Map()

	constructor(config: KnowledgeServiceConfig = {}) {
		this.config = {
			maxFileSize: config.maxFileSize ?? 1024 * 1024, // 1MB
			fileExtensions: config.fileExtensions ?? [
				".ts",
				".tsx",
				".js",
				".jsx",
				".py",
				".java",
				".go",
				".rs",
				".cpp",
				".c",
				".h",
				".cs",
				".kt",
				".swift",
			],
			excludeDirectories: config.excludeDirectories ?? [
				"node_modules",
				".git",
				"dist",
				"build",
				"target",
				"__pycache__",
				".venv",
				"venv",
			],
			enableCitationTracking: config.enableCitationTracking ?? true,
		}
	}

	/**
	 * Index a directory for knowledge base
	 */
	async indexDirectory(directoryPath: string): Promise<number> {
		try {
			const absolutePath = path.resolve(directoryPath)
			let indexedCount = 0

			const files = await this.getFilesToIndex(absolutePath)

			for (const filePath of files) {
				try {
					await this.indexFile(filePath)
					indexedCount++
				} catch (error) {
					console.error(`Failed to index file ${filePath}:`, error)
				}
			}

			console.log(`[KnowledgeService] Indexed ${indexedCount} files from ${directoryPath}`)
			return indexedCount
		} catch (error) {
			throw new Error(`Failed to index directory: ${error}`)
		}
	}

	/**
	 * Index a single file
	 */
	async indexFile(filePath: string): Promise<void> {
		try {
			const absolutePath = path.resolve(filePath)
			const stats = await fs.stat(absolutePath)

			// Check file size
			if (stats.size > this.config.maxFileSize) {
				console.warn(`Skipping ${filePath}: file too large (${stats.size} bytes)`)
				return
			}

			// Check file extension
			const ext = path.extname(filePath)
			if (!this.config.fileExtensions.includes(ext)) {
				return
			}

			// Read file content
			const content = await fs.readFile(absolutePath, "utf-8")
			const lines = content.split("\n")

			const indexedFile: IndexedFile = {
				path: absolutePath,
				content,
				metadata: {
					size: stats.size,
					lines: lines.length,
					language: this.detectLanguage(ext),
					lastModified: stats.mtime,
				},
			}

			this.indexedFiles.set(absolutePath, indexedFile)
		} catch (error) {
			throw new Error(`Failed to index file ${filePath}: ${error}`)
		}
	}

	/**
	 * Search the knowledge base for relevant content
	 */
	async search(query: string, limit: number = 10): Promise<SearchResult[]> {
		try {
			const results: SearchResult[] = []
			const queryLower = query.toLowerCase()

			for (const [filePath, indexedFile] of this.indexedFiles.entries()) {
				const contentLower = indexedFile.content.toLowerCase()
				const matches: Array<{ line: number; snippet: string; context: string }> = []

				// Find matches
				const lines = indexedFile.content.split("\n")
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					if (line.toLowerCase().includes(queryLower)) {
						// Extract context around the match
						const contextStart = Math.max(0, i - 2)
						const contextEnd = Math.min(lines.length, i + 3)
						const context = lines.slice(contextStart, contextEnd).join("\n")

						matches.push({
							line: i + 1,
							snippet: line.trim(),
							context,
						})
					}
				}

				if (matches.length > 0) {
					// Calculate score based on number of matches
					const score = matches.length / lines.length

					results.push({
						file: indexedFile,
						score,
						matches,
					})
				}
			}

			// Sort by score and limit results
			results.sort((a, b) => b.score - a.score)
			return results.slice(0, limit)
		} catch (error) {
			throw new Error(`Failed to search knowledge base: ${error}`)
		}
	}

	/**
	 * Extract citations from search results
	 */
	async extractCitationsFromResults(searchResults: SearchResult[], messageId: string): Promise<Citation[]> {
		if (!this.config.enableCitationTracking) {
			return []
		}

		const citations: Citation[] = []

		for (const result of searchResults) {
			for (const match of result.matches) {
				const citation = {
					id: `${messageId}-${result.file.path}-${match.line}`,
					messageId,
					sourceType: "file" as const,
					sourcePath: result.file.path,
					startLine: match.line,
					endLine: match.line,
					snippet: match.snippet,
					confidence: Math.min(result.score + 0.5, 1.0),
					metadata: {
						extractedAt: new Date(),
						verified: true,
						relevanceScore: result.score,
					},
				}

				citations.push(citation)
			}
		}

		return citations
	}

	/**
	 * Get file content by path
	 */
	async getFileContent(filePath: string): Promise<string | null> {
		try {
			const absolutePath = path.resolve(filePath)
			const indexedFile = this.indexedFiles.get(absolutePath)

			if (indexedFile) {
				return indexedFile.content
			}

			// Try to read from disk if not indexed
			const content = await fs.readFile(absolutePath, "utf-8")
			return content
		} catch (error) {
			console.error(`Failed to get file content: ${error}`)
			return null
		}
	}

	/**
	 * Get context for a file and position
	 */
	async getContext(filePath: string, position: number, contextSize: number = 10): Promise<CompletionContext | null> {
		try {
			const content = await this.getFileContent(filePath)
			if (!content) {
				return null
			}

			const lines = content.split("\n")
			const lineIndex = Math.floor(position / 100) // Approximate line from position

			const contextStart = Math.max(0, lineIndex - contextSize)
			const contextEnd = Math.min(lines.length, lineIndex + contextSize)
			const surroundingCode = lines.slice(contextStart, contextEnd).join("\n")

			// Build completion context
			const context: CompletionContext = {
				id: `ctx-${filePath}-${position}`,
				filePath,
				position,
				surroundingCode,
				projectContext: {
					projectPath: path.dirname(filePath),
					language: this.detectLanguage(path.extname(filePath)),
					dependencies: [],
					recentFiles: Array.from(this.indexedFiles.keys()).slice(0, 10),
				},
				semanticContext: {
					embeddings: [],
					relevantFiles: [],
					concepts: [],
					relationships: [],
				},
			}

			return context
		} catch (error) {
			console.error(`Failed to get context: ${error}`)
			return null
		}
	}

	/**
	 * Clear the knowledge base
	 */
	clearIndex(): void {
		this.indexedFiles.clear()
		console.log("[KnowledgeService] Knowledge base cleared")
	}

	/**
	 * Get index statistics
	 */
	getStats(): {
		totalFiles: number
		totalSize: number
		totalLines: number
		languages: Record<string, number>
	} {
		const stats = {
			totalFiles: this.indexedFiles.size,
			totalSize: 0,
			totalLines: 0,
			languages: {} as Record<string, number>,
		}

		for (const indexedFile of this.indexedFiles.values()) {
			stats.totalSize += indexedFile.metadata.size
			stats.totalLines += indexedFile.metadata.lines

			const lang = indexedFile.metadata.language
			stats.languages[lang] = (stats.languages[lang] || 0) + 1
		}

		return stats
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Get all files to index from a directory
	 */
	private async getFilesToIndex(directoryPath: string): Promise<string[]> {
		const files: string[] = []

		const traverse = async (dir: string): Promise<void> => {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isDirectory()) {
					// Skip excluded directories
					if (!this.config.excludeDirectories.some((excluded: string) => fullPath.includes(excluded))) {
						await traverse(fullPath)
					}
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name)
					if (this.config.fileExtensions.includes(ext)) {
						files.push(fullPath)
					}
				}
			}
		}

		await traverse(directoryPath)
		return files
	}

	/**
	 * Detect programming language from file extension
	 */
	private detectLanguage(extension: string): string {
		const languageMap: Record<string, string> = {
			".ts": "typescript",
			".tsx": "typescript",
			".js": "javascript",
			".jsx": "javascript",
			".py": "python",
			".java": "java",
			".go": "go",
			".rs": "rust",
			".cpp": "cpp",
			".c": "c",
			".h": "c",
			".cs": "csharp",
			".kt": "kotlin",
			".swift": "swift",
		}

		return languageMap[extension] || "unknown"
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: KnowledgeService | null = null

export function getKnowledgeService(config?: KnowledgeServiceConfig): KnowledgeService {
	if (!instance) {
		instance = new KnowledgeService(config)
	}
	return instance
}

export function resetKnowledgeService(): void {
	instance = null
}

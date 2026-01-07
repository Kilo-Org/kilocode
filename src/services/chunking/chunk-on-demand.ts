// kilocode_change - new file

import { readFile } from "fs/promises"
import { createHash } from "crypto"
import path from "path"

export interface FileChunk {
	id: string
	filePath: string
	startLine: number
	endLine: number
	content: string
	size: number
	hash: string
	embedding?: number[]
	metadata: {
		language: string
		symbols: string[]
		dependencies: string[]
		complexity: number
	}
}

export interface ChunkMetadata {
	filePath: string
	totalLines: number
	totalChunks: number
	chunkSize: number
	lastModified: number
	fileHash: string
	language: string
}

export interface ChunkRequest {
	filePath: string
	startLine?: number
	endLine?: number
	radius?: number
	maxChunks?: number
}

/**
 * High-performance chunk-on-demand system for large files
 */
export class ChunkOnDemandService {
	private chunkCache: Map<string, FileChunk[]> = new Map()
	private metadataCache: Map<string, ChunkMetadata> = new Map()
	private maxChunkSize = 1000 // lines per chunk
	private maxCacheSize = 100 // max files to cache
	private maxFileSize = 1024 * 1024 // 1MB threshold for chunking

	/**
	 * Get chunks for a file (loads and chunks if necessary)
	 */
	async getChunks(filePath: string, request?: ChunkRequest): Promise<FileChunk[]> {
		// Check if file needs chunking
		const stats = await this.getFileStats(filePath)

		if (stats.size <= this.maxFileSize) {
			// Small file - return as single chunk
			return [await this.createSingleChunk(filePath)]
		}

		// Large file - use chunking
		let chunks = this.chunkCache.get(filePath)

		if (!chunks) {
			chunks = await this.chunkFile(filePath)
			this.cacheChunks(filePath, chunks)
		}

		// Filter chunks based on request
		if (request) {
			return this.filterChunks(chunks, request)
		}

		return chunks
	}

	/**
	 * Get specific chunks around a line number
	 */
	async getChunksAroundLine(filePath: string, line: number, radius: number = 50): Promise<FileChunk[]> {
		const chunks = await this.getChunks(filePath, {
			filePath,
			startLine: line - radius,
			endLine: line + radius,
		})
		return chunks.sort((a, b) => Math.abs(a.startLine - line) - Math.abs(b.startLine - line))
	}

	/**
	 * Get file metadata
	 */
	async getFileMetadata(filePath: string): Promise<ChunkMetadata> {
		let metadata = this.metadataCache.get(filePath)

		if (!metadata) {
			metadata = await this.createFileMetadata(filePath)
			this.metadataCache.set(filePath, metadata)
		}

		return metadata
	}

	/**
	 * Preload chunks for a file
	 */
	async preloadFile(filePath: string): Promise<void> {
		await this.getChunks(filePath)
	}

	/**
	 * Clear cached data for a file
	 */
	clearFileCache(filePath: string): void {
		this.chunkCache.delete(filePath)
		this.metadataCache.delete(filePath)
	}

	/**
	 * Clear all caches
	 */
	clearAllCaches(): void {
		this.chunkCache.clear()
		this.metadataCache.clear()
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): any {
		return {
			cachedFiles: this.chunkCache.size,
			cachedMetadata: this.metadataCache.size,
			maxCacheSize: this.maxCacheSize,
			maxChunkSize: this.maxChunkSize,
			maxFileSize: this.maxFileSize,
		}
	}

	// Private methods

	private async getFileStats(filePath: string): Promise<{ size: number; mtime: number }> {
		const fs = await import("fs/promises")
		const stats = await fs.stat(filePath)
		return {
			size: stats.size,
			mtime: stats.mtime.getTime(),
		}
	}

	private async createFileMetadata(filePath: string): Promise<ChunkMetadata> {
		const content = await readFile(filePath, "utf8")
		const lines = content.split("\n")
		const stats = await this.getFileStats(filePath)
		const language = this.detectLanguage(filePath)

		return {
			filePath,
			totalLines: lines.length,
			totalChunks: Math.ceil(lines.length / this.maxChunkSize),
			chunkSize: this.maxChunkSize,
			lastModified: stats.mtime,
			fileHash: this.createHash(content),
			language,
		}
	}

	private async createSingleChunk(filePath: string): Promise<FileChunk> {
		const content = await readFile(filePath, "utf8")
		const lines = content.split("\n")
		const language = this.detectLanguage(filePath)

		return {
			id: `${filePath}:0-${lines.length}`,
			filePath,
			startLine: 1,
			endLine: lines.length,
			content,
			size: content.length,
			hash: this.createHash(content),
			metadata: {
				language,
				symbols: this.extractSymbols(content, language),
				dependencies: this.extractDependencies(content, language),
				complexity: this.calculateComplexity(content, language),
			},
		}
	}

	private async chunkFile(filePath: string): Promise<FileChunk[]> {
		const content = await readFile(filePath, "utf8")
		const lines = content.split("\n")
		const language = this.detectLanguage(filePath)
		const chunks: FileChunk[] = []

		for (let i = 0; i < lines.length; i += this.maxChunkSize) {
			const startLine = i + 1
			const endLine = Math.min(i + this.maxChunkSize, lines.length)
			const chunkContent = lines.slice(i, endLine).join("\n")

			const chunk: FileChunk = {
				id: `${filePath}:${startLine}-${endLine}`,
				filePath,
				startLine,
				endLine,
				content: chunkContent,
				size: chunkContent.length,
				hash: this.createHash(chunkContent),
				metadata: {
					language,
					symbols: this.extractSymbols(chunkContent, language),
					dependencies: this.extractDependencies(chunkContent, language),
					complexity: this.calculateComplexity(chunkContent, language),
				},
			}

			chunks.push(chunk)
		}

		return chunks
	}

	private cacheChunks(filePath: string, chunks: FileChunk[]): void {
		// Implement LRU cache eviction if needed
		if (this.chunkCache.size >= this.maxCacheSize) {
			const firstKey = this.chunkCache.keys().next().value
			if (firstKey) {
				this.chunkCache.delete(firstKey)
				this.metadataCache.delete(firstKey)
			}
		}

		this.chunkCache.set(filePath, chunks)
	}

	private filterChunks(chunks: FileChunk[], request: ChunkRequest): FileChunk[] {
		let filtered = chunks

		if (request.startLine !== undefined || request.endLine !== undefined) {
			const start = request.startLine ?? 1
			const end = request.endLine ?? Infinity

			filtered = chunks.filter((chunk) => chunk.startLine <= end && chunk.endLine >= start)
		}

		if (request.maxChunks && filtered.length > request.maxChunks) {
			// Sort by relevance to the requested area
			const centerLine = request.startLine || request.endLine || 1

			filtered = filtered
				.sort((a, b) => {
					const aDistance = Math.min(Math.abs(a.startLine - centerLine), Math.abs(a.endLine - centerLine))
					const bDistance = Math.min(Math.abs(b.startLine - centerLine), Math.abs(b.endLine - centerLine))
					return aDistance - bDistance
				})
				.slice(0, request.maxChunks)
		}

		return filtered
	}

	private detectLanguage(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase()
		const mapping: Record<string, string> = {
			".py": "python",
			".js": "javascript",
			".jsx": "javascript",
			".ts": "typescript",
			".tsx": "typescript",
			".java": "java",
			".cpp": "cpp",
			".c": "c",
			".cs": "csharp",
			".go": "go",
			".rs": "rust",
			".php": "php",
			".rb": "ruby",
			".swift": "swift",
			".kt": "kotlin",
			".scala": "scala",
			".html": "html",
			".css": "css",
			".scss": "scss",
			".sass": "sass",
			".less": "less",
			".xml": "xml",
			".json": "json",
			".yaml": "yaml",
			".yml": "yaml",
			".toml": "toml",
			".md": "markdown",
			".sql": "sql",
			".sh": "shell",
			".bash": "shell",
			".zsh": "shell",
			".fish": "shell",
		}

		return mapping[ext] || "text"
	}

	private extractSymbols(content: string, language: string): string[] {
		const symbols: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()

			switch (language) {
				case "python":
					// Extract function and class definitions
					{
						const funcMatch = trimmed.match(/^def\s+(\w+)/)
						const classMatch = trimmed.match(/^class\s+(\w+)/)
						if (funcMatch) symbols.push(funcMatch[1])
						if (classMatch) symbols.push(classMatch[1])
					}
					break

				case "javascript":
				case "typescript":
					// Extract function, class, and variable declarations
					{
						const jsFuncMatch = trimmed.match(
							/(?:function\s+(\w+)|(\w+)\s*=\s*function|const\s+(\w+)\s*=|class\s+(\w+))/,
						)
						if (jsFuncMatch) {
							const symbol = jsFuncMatch[1] || jsFuncMatch[2] || jsFuncMatch[3] || jsFuncMatch[4]
							if (symbol) symbols.push(symbol)
						}
					}
					break

				case "java":
					// Extract class and method definitions
					{
						const javaClassMatch = trimmed.match(/^(?:public\s+)?class\s+(\w+)/)
						const javaMethodMatch = trimmed.match(
							/(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/,
						)
						if (javaClassMatch) symbols.push(javaClassMatch[1])
						if (javaMethodMatch) symbols.push(javaMethodMatch[1])
					}
					break
			}
		}

		return symbols
	}

	private extractDependencies(content: string, language: string): string[] {
		const dependencies: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()

			switch (language) {
				case "python":
					// Extract imports
					{
						const importMatch = trimmed.match(/^(?:from\s+(\w+)|import\s+(\w+))/)
						if (importMatch) {
							const dep = importMatch[1] || importMatch[2]
							if (dep && !dep.startsWith(".")) dependencies.push(dep)
						}
					}
					break

				case "javascript":
				case "typescript":
					// Extract imports and requires
					{
						const jsImportMatch = trimmed.match(
							/^(?:import.*from\s+['"]([^'"]+)['"]|const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\))/,
						)
						if (jsImportMatch) {
							const dep = jsImportMatch[1] || jsImportMatch[2]
							if (dep && !dep.startsWith(".")) dependencies.push(dep)
						}
					}
					break

				case "java":
					// Extract package imports
					{
						const javaImportMatch = trimmed.match(/^import\s+([\w.]+)/)
						if (javaImportMatch) dependencies.push(javaImportMatch[1])
					}
					break
			}
		}

		return Array.from(new Set(dependencies)) // Remove duplicates
	}

	private calculateComplexity(content: string, language: string): number {
		let complexity = 0
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()

			// Count control flow statements
			if (trimmed.match(/^(if|else|elif|for|while|switch|case|catch|try)/)) {
				complexity += 1
			}

			// Count nested structures (rough approximation)
			const nestingLevel = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
			complexity += Math.max(0, nestingLevel)

			// Count logical operators
			const logicalOps = (line.match(/&&|\|\||and|or)/g) || []).length
			complexity += logicalOps * 0.5

			// Count function calls (rough approximation)
			const functionCalls = (line.match(/\w+\(/g) || []).length
			complexity += functionCalls * 0.3
		}

		return Math.round(complexity * 10) / 10 // Round to 1 decimal place
	}

	private createHash(content: string): string {
		return createHash("sha256").update(content).digest("hex").substring(0, 16)
	}
}

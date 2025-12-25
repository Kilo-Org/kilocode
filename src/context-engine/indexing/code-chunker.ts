import type { CodeChunk, ChunkType, ChunkMetadata } from "../types"

/**
 * AST-based code chunker that intelligently splits code into semantic units
 */
export class CodeChunker {
	private maxChunkSize: number
	private chunkOverlap: number

	constructor(maxChunkSize: number = 1000, chunkOverlap: number = 100) {
		this.maxChunkSize = maxChunkSize
		this.chunkOverlap = chunkOverlap
	}

	/**
	 * Chunk code from AST (will be implemented after AST parser integration)
	 */
	async chunkFromAST(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
		// TODO: Integrate with Tree-sitter parser
		// For now, return basic chunks
		return this.chunkByLines(filePath, content, language)
	}

	/**
	 * Simple line-based chunking (fallback)
	 */
	private chunkByLines(filePath: string, content: string, language: string): CodeChunk[] {
		const lines = content.split("\n")
		const chunks: CodeChunk[] = []
		let currentChunk: string[] = []
		let startLine = 1

		for (let i = 0; i < lines.length; i++) {
			currentChunk.push(lines[i])

			const chunkSize = currentChunk.join("\n").length
			if (chunkSize >= this.maxChunkSize || i === lines.length - 1) {
				if (currentChunk.length > 0) {
					chunks.push(this.createChunk(filePath, currentChunk, startLine, language))
					// Overlap: keep last few lines for next chunk
					const overlapLines = Math.min(this.chunkOverlap / 20, currentChunk.length)
					currentChunk = currentChunk.slice(-overlapLines)
					startLine = i + 2 - overlapLines
				}
			}
		}

		return chunks
	}

	private createChunk(filePath: string, lines: string[], startLine: number, language: string): CodeChunk {
		const content = lines.join("\n")
		return {
			id: this.generateChunkId(filePath, startLine),
			filePath,
			content,
			summary: this.generateSummary(content, language),
			startLine,
			endLine: startLine + lines.length - 1,
			type: this.detectChunkType(content, language),
			language,
			metadata: {
				lastModified: Date.now(),
			},
		}
	}

	private generateChunkId(filePath: string, startLine: number): string {
		return `${filePath}:${startLine}`
	}

	private generateSummary(content: string, language: string): string {
		// TODO: Use  LLM or heuristics to generate better summaries
		const firstLine = content.split("\n")[0].trim()
		return firstLine.substring(0, 100)
	}

	private detectChunkType(content: string, language: string): ChunkType {
		// Simple heuristic-based detection
		const trimmed = content.trim()

		if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("#")) {
			return "comment"
		}

		if (language === "typescript" || language === "javascript") {
			if (trimmed.includes("function ") || trimmed.includes("const ") || trimmed.includes("async ")) {
				return "function"
			}
			if (trimmed.includes("class ")) {
				return "class"
			}
			if (trimmed.includes("interface ")) {
				return "interface"
			}
			if (trimmed.includes("type ")) {
				return "type"
			}
			if (trimmed.includes("import ")) {
				return "import"
			}
		}

		if (language === "python") {
			if (trimmed.includes("def ")) {
				return "function"
			}
			if (trimmed.includes("class ")) {
				return "class"
			}
			if (trimmed.includes("import ") || trimmed.includes("from ")) {
				return "import"
			}
		}

		return "variable"
	}

	/**
	 * Chunk code based on function/class boundaries (requires AST)
	 */
	async chunkBySymbols(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
		// TODO: Implement with Tree-sitter
		return this.chunkFromAST(filePath, content, language)
	}

	/**
	 * Extract metadata from chunk (requires AST for accuracy)
	 */
	extractMetadata(chunk: CodeChunk): ChunkMetadata {
		// TODO: Extract imports, exports, dependencies using AST
		return {
			lastModified: Date.now(),
			imports: this.extractImports(chunk.content, chunk.language),
			exports: this.extractExports(chunk.content, chunk.language),
		}
	}

	private extractImports(content: string, language: string): string[] {
		const imports: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()
			if (language === "typescript" || language === "javascript") {
				if (trimmed.startsWith("import ")) {
					imports.push(trimmed)
				}
			} else if (language === "python") {
				if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
					imports.push(trimmed)
				}
			}
		}

		return imports
	}

	private extractExports(content: string, language: string): string[] {
		const exports: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()
			if (language === "typescript" || language === "javascript") {
				if (trimmed.startsWith("export ")) {
					exports.push(trimmed)
				}
			}
		}

		return exports
	}
}

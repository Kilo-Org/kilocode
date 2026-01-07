// kilocode_change - new file

export interface TokenBudget {
	maxTokens: number
	reservedTokens: number
	availableTokens: number
	usedTokens: number
}

export interface ContextPruningStrategy {
	removeComments: boolean
	removeWhitespace: boolean
	minifyCode: boolean
	summarizeLongFiles: boolean
	prioritizeRecent: boolean
	prioritizeRelevant: boolean
}

export interface TokenUsageStats {
	totalTokens: number
	originalTokens: number
	prunedTokens: number
	compressionRatio: number
	pruningTime: number
}

export interface ContextSummary {
	filePath: string
	summary: string
	tokenCount: number
	importance: number
}

/**
 * High-performance token budgeting and context pruning system
 */
export class TokenManager {
	private maxTokens: number
	private reservedTokens: number
	private pruningStrategy: ContextPruningStrategy
	private contextSummaries: Map<string, ContextSummary> = new Map()

	constructor(maxTokens: number = 128000, reservedTokens: number = 4000) {
		this.maxTokens = maxTokens
		this.reservedTokens = reservedTokens
		this.pruningStrategy = {
			removeComments: true,
			removeWhitespace: true,
			minifyCode: false,
			summarizeLongFiles: true,
			prioritizeRecent: true,
			prioritizeRelevant: true,
		}
	}

	/**
	 * Calculate token budget for a request
	 */
	calculateBudget(contextSize: number): TokenBudget {
		const availableTokens = Math.max(0, this.maxTokens - this.reservedTokens - contextSize)

		return {
			maxTokens: this.maxTokens,
			reservedTokens: this.reservedTokens,
			availableTokens,
			usedTokens: contextSize,
		}
	}

	/**
	 * Prune context to fit within token budget
	 */
	async pruneContext(
		context: Array<{ filePath: string; content: string; importance?: number }>,
		budget: TokenBudget,
	): Promise<{ prunedContext: string; stats: TokenUsageStats }> {
		const startTime = Date.now()
		const originalTokens = this.estimateTokens(JSON.stringify(context))

		if (originalTokens <= budget.availableTokens) {
			return {
				prunedContext: JSON.stringify(context),
				stats: {
					totalTokens: originalTokens,
					originalTokens,
					prunedTokens: 0,
					compressionRatio: 1.0,
					pruningTime: Date.now() - startTime,
				},
			}
		}

		// Sort by importance if available
		const sortedContext = this.sortByImportance(context)

		// Apply pruning strategies
		let prunedContext = sortedContext
		let currentTokens = originalTokens

		// Step 1: Remove comments and whitespace
		if (this.pruningStrategy.removeComments || this.pruningStrategy.removeWhitespace) {
			prunedContext = this.applyBasicPruning(prunedContext)
			currentTokens = this.estimateTokens(JSON.stringify(prunedContext))
		}

		// Step 2: Summarize long files
		if (currentTokens > budget.availableTokens && this.pruningStrategy.summarizeLongFiles) {
			prunedContext = await this.summarizeLongFiles(prunedContext, budget.availableTokens)
			currentTokens = this.estimateTokens(JSON.stringify(prunedContext))
		}

		// Step 3: Remove less important files
		if (currentTokens > budget.availableTokens) {
			prunedContext = this.removeLessImportantFiles(prunedContext, budget.availableTokens)
			currentTokens = this.estimateTokens(JSON.stringify(prunedContext))
		}

		// Step 4: Final truncation if still over budget
		if (currentTokens > budget.availableTokens) {
			prunedContext = this.truncateToBudget(prunedContext, budget.availableTokens)
			currentTokens = this.estimateTokens(JSON.stringify(prunedContext))
		}

		const prunedTokens = originalTokens - currentTokens
		const compressionRatio = currentTokens / originalTokens

		return {
			prunedContext: JSON.stringify(prunedContext),
			stats: {
				totalTokens: currentTokens,
				originalTokens,
				prunedTokens,
				compressionRatio,
				pruningTime: Date.now() - startTime,
			},
		}
	}

	/**
	 * Estimate token count for text (rough approximation)
	 */
	estimateTokens(text: string): number {
		// Rough estimation: ~4 characters per token for most languages
		// This is a simplified approximation - in production, use proper tokenizer
		return Math.ceil(text.length / 4)
	}

	/**
	 * Create a summary for a long file
	 */
	async createFileSummary(filePath: string, content: string): Promise<ContextSummary> {
		const lines = content.split("\n")
		const lineCount = lines.length

		// Simple summarization strategy
		let summary = ""

		if (lineCount <= 100) {
			summary = content // Small files don't need summarization
		} else {
			// Extract key parts: imports, exports, class/function definitions
			const imports = lines
				.filter((line) => line.includes("import") || line.includes("require") || line.includes("#include"))
				.slice(0, 10)

			const exports = lines
				.filter((line) => line.includes("export") || line.includes("module.exports"))
				.slice(0, 10)

			const definitions = lines
				.filter(
					(line) =>
						line.includes("class ") ||
						line.includes("function ") ||
						line.includes("def ") ||
						line.includes("const ") ||
						line.includes("let ") ||
						line.includes("var "),
				)
				.slice(0, 20)

			summary = [
				`// File: ${filePath} (${lineCount} lines)`,
				"// Imports:",
				...imports,
				"// Exports:",
				...exports,
				"// Key Definitions:",
				...definitions,
				"// ... (truncated for brevity)",
			].join("\n")
		}

		const contextSummary: ContextSummary = {
			filePath,
			summary,
			tokenCount: this.estimateTokens(summary),
			importance: this.calculateImportance(filePath, content),
		}

		this.contextSummaries.set(filePath, contextSummary)
		return contextSummary
	}

	/**
	 * Get cached summary for a file
	 */
	getFileSummary(filePath: string): ContextSummary | null {
		return this.contextSummaries.get(filePath) || null
	}

	/**
	 * Clear all cached summaries
	 */
	clearSummaries(): void {
		this.contextSummaries.clear()
	}

	/**
	 * Update pruning strategy
	 */
	updatePruningStrategy(strategy: Partial<ContextPruningStrategy>): void {
		this.pruningStrategy = { ...this.pruningStrategy, ...strategy }
	}

	/**
	 * Get current pruning strategy
	 */
	getPruningStrategy(): ContextPruningStrategy {
		return { ...this.pruningStrategy }
	}

	// Private methods

	private sortByImportance(
		context: Array<{ filePath: string; content: string; importance?: number }>,
	): Array<{ filePath: string; content: string; importance: number }> {
		return context
			.map((item) => ({
				...item,
				importance: item.importance ?? this.calculateImportance(item.filePath, item.content),
			}))
			.sort((a, b) => b.importance - a.importance)
	}

	private calculateImportance(filePath: string, content: string): number {
		let importance = 0

		// File type importance
		if (filePath.includes("test") || filePath.includes("spec")) {
			importance -= 0.2
		} else if (filePath.includes("config") || filePath.includes("settings")) {
			importance += 0.3
		} else if (filePath.includes("index") || filePath.includes("main")) {
			importance += 0.4
		}

		// Content-based importance
		const lines = content.split("\n")
		const classCount = lines.filter((line) => line.includes("class ")).length
		const functionCount = lines.filter((line) => line.includes("function ") || line.includes("def ")).length
		const exportCount = lines.filter((line) => line.includes("export")).length

		importance += Math.min(classCount * 0.1, 0.5)
		importance += Math.min(functionCount * 0.05, 0.3)
		importance += Math.min(exportCount * 0.1, 0.4)

		// Recency bonus (if we have timestamp info)
		if (this.pruningStrategy.prioritizeRecent) {
			importance += 0.1 // Placeholder - would use actual file modification time
		}

		return Math.max(0, Math.min(1, importance))
	}

	private applyBasicPruning(
		context: Array<{ filePath: string; content: string; importance: number }>,
	): Array<{ filePath: string; content: string; importance: number }> {
		return context.map((item) => {
			let prunedContent = item.content

			if (this.pruningStrategy.removeComments) {
				prunedContent = this.removeComments(prunedContent)
			}

			if (this.pruningStrategy.removeWhitespace) {
				prunedContent = this.removeExcessWhitespace(prunedContent)
			}

			if (this.pruningStrategy.minifyCode) {
				prunedContent = this.minifyCode(prunedContent)
			}

			return {
				...item,
				content: prunedContent,
			}
		})
	}

	private removeComments(content: string): string {
		// Simple comment removal - in production, use proper parser
		return content
			.replace(/\/\/.*$/gm, "") // Remove single-line comments
			.replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
			.replace(/#.*$/gm, "") // Remove Python comments
			.replace(/<!--[\s\S]*?-->/g, "") // Remove HTML comments
	}

	private removeExcessWhitespace(content: string): string {
		return content
			.replace(/\s+/g, " ") // Replace multiple spaces with single space
			.replace(/\n\s*\n/g, "\n") // Remove multiple empty lines
			.trim()
	}

	private minifyCode(content: string): string {
		// Basic code minification
		return content
			.replace(/\s*([{}();,])\s*/g, "$1") // Remove spaces around operators
			.replace(/\s+/g, " ") // Replace multiple spaces
			.trim()
	}

	private async summarizeLongFiles(
		context: Array<{ filePath: string; content: string; importance: number }>,
		targetTokens: number,
	): Promise<Array<{ filePath: string; content: string; importance: number }>> {
		const result: Array<{ filePath: string; content: string; importance: number }> = []
		let currentTokens = 0

		for (const item of context) {
			const itemTokens = this.estimateTokens(item.content)

			if (currentTokens + itemTokens <= targetTokens) {
				result.push(item)
				currentTokens += itemTokens
			} else {
				// Summarize this file
				const summary = await this.createFileSummary(item.filePath, item.content)
				const summaryTokens = summary.tokenCount

				if (currentTokens + summaryTokens <= targetTokens) {
					result.push({
						...item,
						content: summary.summary,
					})
					currentTokens += summaryTokens
				}
			}
		}

		return result
	}

	private removeLessImportantFiles(
		context: Array<{ filePath: string; content: string; importance: number }>,
		targetTokens: number,
	): Array<{ filePath: string; content: string; importance: number }> {
		const result: Array<{ filePath: string; content: string; importance: number }> = []
		let currentTokens = 0

		for (const item of context) {
			const itemTokens = this.estimateTokens(item.content)

			if (currentTokens + itemTokens <= targetTokens) {
				result.push(item)
				currentTokens += itemTokens
			} else {
				// Skip this less important file
				continue
			}
		}

		return result
	}

	private truncateToBudget(
		context: Array<{ filePath: string; content: string; importance: number }>,
		targetTokens: number,
	): Array<{ filePath: string; content: string; importance: number }> {
		const result: Array<{ filePath: string; content: string; importance: number }> = []
		let currentTokens = 0

		for (const item of context) {
			const itemTokens = this.estimateTokens(item.content)

			if (currentTokens + itemTokens <= targetTokens) {
				result.push(item)
				currentTokens += itemTokens
			} else {
				// Truncate the content to fit
				const remainingTokens = targetTokens - currentTokens
				if (remainingTokens > 100) {
					// Only add if we have meaningful space
					const truncatedContent = this.truncateContent(item.content, remainingTokens)
					result.push({
						...item,
						content: truncatedContent,
					})
				}
				break
			}
		}

		return result
	}

	private truncateContent(content: string, maxTokens: number): string {
		const targetLength = maxTokens * 4 // Rough approximation
		if (content.length <= targetLength) {
			return content
		}

		// Try to truncate at a reasonable boundary
		const truncated = content.substring(0, targetLength)
		const lastNewline = truncated.lastIndexOf("\n")
		const lastSemicolon = truncated.lastIndexOf(";")
		const lastBrace = truncated.lastIndexOf("}")

		const bestBoundary = Math.max(lastNewline, lastSemicolon, lastBrace)

		if (bestBoundary > targetLength * 0.8) {
			return truncated.substring(0, bestBoundary + 1) + "\n// ... (truncated)"
		}

		return truncated + "\n// ... (truncated)"
	}
}

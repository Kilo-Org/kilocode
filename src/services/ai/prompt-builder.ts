// kilocode_change - new file

import { ContextResult } from "./context-retriever"

export interface PromptTemplate {
	systemInstructions: string
	projectStructure: string
	relevantContext: string
	userQuery: string
}

export interface PromptBuilderConfig {
	maxTokens: number
	systemPrompt: string
	odooSystemPrompt: string
	djangoSystemPrompt: string
	genericSystemPrompt: string
	includeLineNumbers: boolean
	includeFilePaths: boolean
	contextHeader: string
}

/**
 * Dynamic prompt construction with token budgeting and framework-specific rules
 */
export class PromptBuilder {
	private config: PromptBuilderConfig
	private tokenCounter: TokenCounter

	constructor(config: Partial<PromptBuilderConfig> = {}) {
		this.config = {
			maxTokens: 10000,
			systemPrompt: `You are an expert software engineer with deep knowledge of multiple programming languages, frameworks, and best practices. You provide accurate, helpful, and well-structured code solutions.`,
			odooSystemPrompt: `You are an expert Odoo developer with deep knowledge of:
- Odoo ORM patterns and model inheritance (_name, _inherit, _rec_name)
- XML view definitions and record structures
- @api decorators and method patterns
- Module dependencies and manifest structure
- Business logic patterns and workflow automation

When working with Odoo code:
1. Always consider model inheritance chains
2. Understand XML view-record relationships
3. Respect Odoo's coding conventions and security rules
4. Leverage existing ORM methods and utilities
5. Consider multi-language implications (i18n)`,
			djangoSystemPrompt: `You are an expert Django developer with deep knowledge of:
- Django ORM and model relationships
- URL patterns and view structures
- Template inheritance and context
- Management commands and migrations
- Django REST Framework patterns

When working with Django code:
1. Follow Django's MTV architecture
2. Use proper model relationships and querysets
3. Respect URL naming conventions
4. Leverage Django's built-in utilities
5. Consider security best practices`,
			genericSystemPrompt: `You are an expert software engineer with deep knowledge of multiple programming languages, frameworks, and best practices. You provide accurate, helpful, and well-structured code solutions.`,
			includeLineNumbers: true,
			includeFilePaths: true,
			contextHeader: "## Relevant Code Context",
			...config,
		}

		this.tokenCounter = new TokenCounter()
	}

	/**
	 * Build the complete prompt with all components
	 */
	async buildPrompt(
		contextResults: ContextResult[],
		userQuery: string,
		projectType: "odoo" | "django" | "generic" = "generic",
		currentFile?: string,
		projectStructure?: string,
	): Promise<PromptTemplate> {
		// Select appropriate system instructions
		const systemInstructions = this.getSystemInstructions(projectType)

		// Build project structure section
		const projectStructureSection = this.buildProjectStructureSection(projectStructure)

		// Build relevant context section with token budgeting
		const relevantContextSection = await this.buildRelevantContextSection(contextResults)

		// Calculate total tokens and adjust if necessary
		const totalTokens = this.tokenCounter.countTokens(
			systemInstructions + projectStructureSection + relevantContextSection + userQuery,
		)

		let finalContext = relevantContextSection
		if (totalTokens > this.config.maxTokens) {
			finalContext = await this.adjustContextForTokenLimit(
				contextResults,
				this.config.maxTokens -
					this.tokenCounter.countTokens(systemInstructions + projectStructureSection + userQuery),
			)
		}

		return {
			systemInstructions,
			projectStructure: projectStructureSection,
			relevantContext: finalContext,
			userQuery,
		}
	}

	/**
	 * Get framework-specific system instructions
	 */
	private getSystemInstructions(projectType: "odoo" | "django" | "generic"): string {
		const basePrompt = this.config.systemPrompt

		switch (projectType) {
			case "odoo":
				return basePrompt + "\n\n" + this.config.odooSystemPrompt
			case "django":
				return basePrompt + "\n\n" + this.config.djangoSystemPrompt
			default:
				return basePrompt + "\n\n" + this.config.genericSystemPrompt
		}
	}

	/**
	 * Build project structure section
	 */
	private buildProjectStructureSection(projectStructure?: string): string {
		if (!projectStructure) {
			return ""
		}

		return `## Project Structure
\`\`\`
${projectStructure}
\`\`\`
`
	}

	/**
	 * Build relevant context section from retrieved results
	 */
	private async buildRelevantContextSection(contextResults: ContextResult[]): Promise<string> {
		if (contextResults.length === 0) {
			return ""
		}

		const sections: string[] = [this.config.contextHeader]

		// Group results by file for better organization
		const resultsByFile = this.groupResultsByFile(contextResults)

		for (const [filePath, fileResults] of Object.entries(resultsByFile)) {
			const fileName = filePath.split("/").pop() || filePath
			sections.push(`### ${fileName}`)
			sections.push(`**Path:** \`${filePath}\``)

			for (const result of fileResults) {
				const codeBlock = this.formatCodeBlock(result)
				sections.push(codeBlock)
			}

			sections.push("") // Add spacing between files
		}

		return sections.join("\n")
	}

	/**
	 * Format a single code block with metadata
	 */
	private formatCodeBlock(result: ContextResult): string {
		const lines = result.content.split("\n")
		const startLine = result.startLine + 1
		const endLine = result.endLine + 1

		let lineNumbers = ""
		if (this.config.includeLineNumbers) {
			lineNumbers = lines.map((_, index) => (startLine + index).toString().padStart(4, " ")).join("\n")
		}

		let filePathInfo = ""
		if (this.config.includeFilePaths) {
			filePathInfo = ` (${result.filePath}:${startLine}-${endLine})`
		}

		let scoreInfo = ""
		if (result.score > 0.7) {
			scoreInfo = ` ⭐${(result.score * 100).toFixed(0)}%`
		}

		const header = `**${result.source.toUpperCase()}${filePathInfo}${scoreInfo}**`

		if (lineNumbers) {
			return `${header}
\`\`\`diff
${lineNumbers}
${lines.join("\n")}
\`\`\``
		} else {
			return `${header}
\`\`\`${this.getLanguageFromPath(result.filePath)}
${result.content}
\`\`\``
		}
	}

	/**
	 * Group results by file path
	 */
	private groupResultsByFile(results: ContextResult[]): Record<string, ContextResult[]> {
		const grouped: Record<string, ContextResult[]> = {}

		for (const result of results) {
			if (!grouped[result.filePath]) {
				grouped[result.filePath] = []
			}
			grouped[result.filePath].push(result)
		}

		// Sort results within each file by score
		for (const fileResults of Object.values(grouped)) {
			fileResults.sort((a, b) => b.score - a.score)
		}

		return grouped
	}

	/**
	 * Adjust context to fit within token limit
	 */
	private async adjustContextForTokenLimit(results: ContextResult[], tokenLimit: number): Promise<string> {
		const adjustedResults: ContextResult[] = []
		let currentTokens = 0
		const headerTokens = this.tokenCounter.countTokens(this.config.contextHeader)

		if (headerTokens >= tokenLimit) {
			return this.config.contextHeader
		}

		currentTokens += headerTokens

		// Add results while staying within token limit
		for (const result of results) {
			const resultTokens = this.estimateResultTokens(result)

			if (currentTokens + resultTokens <= tokenLimit) {
				adjustedResults.push(result)
				currentTokens += resultTokens
			} else {
				// Try to add a truncated version
				const remainingTokens = tokenLimit - currentTokens
				if (remainingTokens > 100) {
					// Minimum meaningful content
					const truncatedResult = this.truncateResult(result, remainingTokens)
					adjustedResults.push(truncatedResult)
				}
				break
			}
		}

		return this.buildRelevantContextSection(adjustedResults)
	}

	/**
	 * Estimate tokens for a result
	 */
	private estimateResultTokens(result: ContextResult): number {
		const contentTokens = this.tokenCounter.countTokens(result.content)
		const metadataTokens = 50 // Rough estimate for file path, line numbers, etc.
		return contentTokens + metadataTokens
	}

	/**
	 * Truncate a result to fit within token limit
	 */
	private truncateResult(result: ContextResult, tokenLimit: number): ContextResult {
		const maxChars = Math.floor((tokenLimit - 50) * 4) // Rough chars to tokens conversion
		const truncatedContent = result.content.substring(0, maxChars)

		return {
			...result,
			content: truncatedContent + "\n... [truncated]",
			score: result.score * 0.8, // Penalize truncated results
		}
	}

	/**
	 * Get language from file path
	 */
	private getLanguageFromPath(filePath: string): string {
		const ext = filePath.split(".").pop()?.toLowerCase()

		const languageMap: Record<string, string> = {
			py: "python",
			js: "javascript",
			ts: "typescript",
			jsx: "jsx",
			tsx: "tsx",
			xml: "xml",
			json: "json",
			md: "markdown",
			sql: "sql",
			html: "html",
			css: "css",
			scss: "scss",
			java: "java",
			cpp: "cpp",
			c: "c",
			go: "go",
			rs: "rust",
			php: "php",
			rb: "ruby",
		}

		return languageMap[ext || ""] || "text"
	}

	/**
	 * Get final prompt as formatted string
	 */
	async getFormattedPrompt(
		contextResults: ContextResult[],
		userQuery: string,
		projectType: "odoo" | "django" | "generic" = "generic",
		currentFile?: string,
		projectStructure?: string,
	): Promise<string> {
		const template = await this.buildPrompt(contextResults, userQuery, projectType, currentFile, projectStructure)

		const sections = [
			template.systemInstructions,
			template.projectStructure,
			template.relevantContext,
			`## User Query\n${userQuery}`,
		]

		return sections.filter((section) => section.trim()).join("\n\n")
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<PromptBuilderConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Get current configuration
	 */
	getConfig(): PromptBuilderConfig {
		return { ...this.config }
	}
}

/**
 * Simple token counter for rough estimation
 */
class TokenCounter {
	countTokens(text: string): number {
		// Rough estimation: ~4 characters per token
		// In production, use a proper tokenizer like tiktoken
		return Math.ceil(text.length / 4)
	}
}

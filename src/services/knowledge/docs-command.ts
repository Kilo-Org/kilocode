// kilocode_change - new file

import { KnowledgeService } from "./knowledge-service"
import { DocumentationSource, SearchQuery } from "./types"

export interface DocsCommandConfig {
	knowledgeService: KnowledgeService
}

export interface DocsCommandResult {
	type: "dropdown" | "search" | "error"
	data?: any
	error?: string
}

export interface DocsDropdownItem {
	id: string
	name: string
	type: "source" | "recent" | "suggestion"
	description?: string
	metadata?: any
}

/**
 * DocsCommand - Handles @docs command functionality
 *
 * This class provides:
 * - Dropdown suggestions for @docs mentions
 * - Search functionality for documentation
 * - Context-aware recommendations
 */
export class DocsCommand {
	private knowledgeService: KnowledgeService
	private recentSearches: string[] = []
	private maxRecentSearches = 10

	constructor(config: DocsCommandConfig) {
		this.knowledgeService = config.knowledgeService
	}

	/**
	 * Handle @docs command input
	 */
	async handleCommand(input: string): Promise<DocsCommandResult> {
		try {
			// Check if this is a search request or dropdown request
			if (input.includes(" ")) {
				// This is a search query
				const query = input.trim()
				return await this.performSearch(query)
			} else {
				// This is a dropdown request
				return await this.getDropdownItems(input)
			}
		} catch (error) {
			console.error("[DocsCommand] Error handling command:", error)
			return {
				type: "error",
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Get dropdown items for @docs suggestions
	 */
	async getDropdownItems(query: string): Promise<DocsCommandResult> {
		const items: DocsDropdownItem[] = []

		// Get available documentation sources
		const sources = await this.knowledgeService.getDocumentationSources()

		// Add source items
		for (const source of sources) {
			items.push({
				id: source.id,
				name: source.name,
				type: "source",
				description: `${source.type} - ${source.metadata.tags.join(", ")}`,
				metadata: source,
			})
		}

		// Add recent searches
		for (const recent of this.recentSearches.slice(0, 5)) {
			items.push({
				id: `recent-${recent}`,
				name: recent,
				type: "recent",
				description: "Recent search",
			})
		}

		// Add suggestions based on query
		if (query.length > 0) {
			const suggestions = await this.generateSuggestions(query)
			for (const suggestion of suggestions) {
				items.push({
					id: `suggestion-${suggestion}`,
					name: suggestion,
					type: "suggestion",
					description: "Search suggestion",
				})
			}
		}

		// Filter items based on query
		const filteredItems =
			query.length > 0
				? items.filter(
						(item) =>
							item.name.toLowerCase().includes(query.toLowerCase()) ||
							item.description?.toLowerCase().includes(query.toLowerCase()),
					)
				: items

		return {
			type: "dropdown",
			data: filteredItems.slice(0, 10), // Limit to 10 items
		}
	}

	/**
	 * Perform documentation search
	 */
	async performSearch(query: string): Promise<DocsCommandResult> {
		// Add to recent searches
		this.addToRecentSearches(query)

		// Build search query
		const searchQuery: SearchQuery = {
			query,
			limit: 20,
			threshold: 0.3,
		}

		// Execute search
		const results = await this.knowledgeService.search(searchQuery)

		// Format results for display
		const formattedResults = results.results.map((result) => ({
			id: result.chunk.id,
			title: result.chunk.metadata.title || "Untitled",
			content: result.chunk.content.substring(0, 300) + "...",
			source: result.chunk.metadata.sourceUrl || result.chunk.metadata.sourceFile || "Unknown",
			score: result.score,
			relevance: result.relevance,
			tags: result.chunk.metadata.tags || [],
			section: result.chunk.metadata.section,
		}))

		return {
			type: "search",
			data: {
				query,
				results: formattedResults,
				totalResults: results.totalResults,
				sources: results.sources,
				executionTime: results.executionTime,
			},
		}
	}

	/**
	 * Generate search suggestions based on available documentation
	 */
	private async generateSuggestions(query: string): Promise<string[]> {
		const sources = await this.knowledgeService.getDocumentationSources()
		const suggestions: string[] = []

		// Generate framework-specific suggestions
		const frameworks = ["odoo", "django", "react", "vue", "angular", "node", "express"]

		for (const framework of frameworks) {
			if (query.toLowerCase().includes(framework)) {
				suggestions.push(`${framework} tutorial`)
				suggestions.push(`${framework} best practices`)
				suggestions.push(`${framework} examples`)
				suggestions.push(`${framework} api reference`)
			}
		}

		// Generate general suggestions based on query keywords
		const keywords = query.toLowerCase().split(/\s+/)

		if (keywords.includes("how")) {
			suggestions.push("how to implement")
			suggestions.push("how to configure")
			suggestions.push("how to install")
		}

		if (keywords.includes("error") || keywords.includes("fix")) {
			suggestions.push("troubleshooting guide")
			suggestions.push("common errors")
			suggestions.push("debugging")
		}

		if (keywords.includes("example")) {
			suggestions.push("code examples")
			suggestions.push("sample code")
			suggestions.push("tutorial")
		}

		// Add source-specific suggestions
		for (const source of sources) {
			if (source.name.toLowerCase().includes(query.toLowerCase())) {
				suggestions.push(`${source.name} getting started`)
				suggestions.push(`${source.name} documentation`)
			}
		}

		// Remove duplicates and limit
		return [...new Set(suggestions)].slice(0, 5)
	}

	/**
	 * Add query to recent searches
	 */
	private addToRecentSearches(query: string): void {
		// Remove if already exists
		this.recentSearches = this.recentSearches.filter((search) => search !== query)

		// Add to beginning
		this.recentSearches.unshift(query)

		// Limit to max recent searches
		this.recentSearches = this.recentSearches.slice(0, this.maxRecentSearches)
	}

	/**
	 * Get context-aware suggestions based on current file/content
	 */
	async getContextualSuggestions(context?: {
		filePath?: string
		fileContent?: string
		cursorPosition?: number
	}): Promise<DocsDropdownItem[]> {
		const items: DocsDropdownItem[] = []

		// Analyze file content for framework detection
		if (context?.fileContent) {
			const frameworks = this.detectFrameworks(context.fileContent)

			for (const framework of frameworks) {
				items.push({
					id: `context-${framework}`,
					name: `${framework} documentation`,
					type: "suggestion",
					description: `Relevant to current file`,
				})
			}
		}

		// Add file-specific suggestions
		if (context?.filePath) {
			const extension = context.filePath.split(".").pop()?.toLowerCase()

			switch (extension) {
				case "py":
					items.push({
						id: "context-python",
						name: "Python documentation",
						type: "suggestion",
						description: "Python language reference",
					})
					break
				case "js":
				case "ts":
				case "jsx":
				case "tsx":
					items.push({
						id: "context-javascript",
						name: "JavaScript documentation",
						type: "suggestion",
						description: "JavaScript/TypeScript reference",
					})
					break
				case "html":
					items.push({
						id: "context-html",
						name: "HTML documentation",
						type: "suggestion",
						description: "HTML and web standards",
					})
					break
				case "css":
					items.push({
						id: "context-css",
						name: "CSS documentation",
						type: "suggestion",
						description: "CSS styling reference",
					})
					break
			}
		}

		return items
	}

	/**
	 * Detect frameworks from file content
	 */
	private detectFrameworks(content: string): string[] {
		const frameworks: string[] = []
		const contentLower = content.toLowerCase()

		// Framework detection patterns
		const patterns = {
			odoo: ["_name", "_inherit", "odoo", "models.model", "fields.selection"],
			django: ["from django", "models.model", "render", "urlpatterns"],
			react: ["react", "usestate", "useeffect", "jsx", "component"],
			vue: ["vue", "v-model", "@click", "created()", "mounted()"],
			angular: ["@angular", "component", "ngmodel", "ngif"],
			node: ["require(", "module.exports", "npm install", "node_modules"],
			express: ["express()", "app.get", "app.post", "res.send"],
			flask: ["flask", "@app.route", "render_template", "request.form"],
		}

		for (const [framework, keywords] of Object.entries(patterns)) {
			if (keywords.some((keyword) => contentLower.includes(keyword))) {
				frameworks.push(framework)
			}
		}

		return frameworks
	}

	/**
	 * Get documentation statistics
	 */
	async getStatistics(): Promise<{
		totalSources: number
		totalChunks: number
		totalSize: string
		sourcesByType: Record<string, number>
		lastUpdated: Date | null
	}> {
		const stats = await this.knowledgeService.getStatistics()

		return {
			...stats,
			totalSize: this.formatBytes(stats.totalSize),
		}
	}

	/**
	 * Format bytes to human readable format
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) return "0 Bytes"

		const k = 1024
		const sizes = ["Bytes", "KB", "MB", "GB"]
		const i = Math.floor(Math.log(bytes) / Math.log(k))

		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
	}

	/**
	 * Clear recent searches
	 */
	clearRecentSearches(): void {
		this.recentSearches = []
	}

	/**
	 * Get recent searches
	 */
	getRecentSearches(): string[] {
		return [...this.recentSearches]
	}
}

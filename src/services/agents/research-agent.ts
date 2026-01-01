// kilocode_change - new file

import { BaseAgent } from "./base-agent"
import { AgentTask, AgentConfig } from "./types"
import { KnowledgeService, SearchQuery, DocumentationSource } from "../knowledge"
import { AIService } from "../ai"

export interface ResearchAgentConfig extends AgentConfig {
	aiService: AIService
	knowledgeService: KnowledgeService
	workspaceRoot: string
}

export interface ResearchTask {
	query: string
	context?: string
	framework?: string
	version?: string
	searchStrategy?: "broad" | "specific" | "comprehensive"
	maxResults?: number
}

export interface ResearchResult {
	query: string
	results: any[]
	sources: DocumentationSource[]
	summaries: string[]
	recommendations: string[]
	confidence: number
	executionTime: number
}

/**
 * ResearchAgent - Specialized agent for documentation research and knowledge retrieval
 *
 * This agent is responsible for:
 * - Searching external documentation sources
 * - Analyzing and summarizing research results
 * - Providing context-specific information for other agents
 * - Maintaining knowledge base freshness
 */
export class ResearchAgent extends BaseAgent {
	private knowledgeService: KnowledgeService
	private aiService: AIService
	private workspaceRoot: string

	constructor(config: ResearchAgentConfig) {
		super({
			...config,
			type: "research",
			capabilities: [
				{
					name: "documentation_search",
					description: "Search and retrieve information from external documentation",
					inputTypes: ["string", "object"],
					outputTypes: ["object"],
				},
				{
					name: "knowledge_synthesis",
					description: "Synthesize information from multiple sources",
					inputTypes: ["array"],
					outputTypes: ["string"],
				},
				{
					name: "context_analysis",
					description: "Analyze code context and determine research needs",
					inputTypes: ["string", "object"],
					outputTypes: ["object"],
				},
			],
		})

		this.knowledgeService = config.knowledgeService
		this.aiService = config.aiService
		this.workspaceRoot = config.workspaceRoot
	}

	/**
	 * Execute a research task
	 */
	async executeTask(task: AgentTask): Promise<any> {
		console.log(`[ResearchAgent] Executing task: ${task.id}`)

		const researchTask = task.input as ResearchTask
		if (!researchTask.query) {
			throw new Error("Research task must include a query")
		}

		try {
			// Determine search strategy
			const searchStrategy = researchTask.searchStrategy || this.determineSearchStrategy(researchTask)

			// Perform research based on strategy
			let result: ResearchResult

			switch (searchStrategy) {
				case "comprehensive":
					result = await this.performComprehensiveResearch(researchTask)
					break
				case "specific":
					result = await this.performSpecificResearch(researchTask)
					break
				case "broad":
				default:
					result = await this.performBroadResearch(researchTask)
					break
			}

			// Update agent statistics
			this.updateStats(true)

			console.log(`[ResearchAgent] Research completed for task: ${task.id}`)
			return result
		} catch (error) {
			this.updateStats(false)
			console.error(`[ResearchAgent] Research failed for task: ${task.id}:`, error)
			throw error
		}
	}

	/**
	 * Determine the best search strategy based on the query
	 */
	private determineSearchStrategy(task: ResearchTask): "broad" | "specific" | "comprehensive" {
		const query = task.query.toLowerCase()

		// Check for specific framework mentions
		if (task.framework || query.includes("odoo") || query.includes("django") || query.includes("react")) {
			return "specific"
		}

		// Check for comprehensive research indicators
		if (
			query.includes("how to") ||
			query.includes("tutorial") ||
			query.includes("guide") ||
			query.includes("best practices") ||
			query.includes("architecture")
		) {
			return "comprehensive"
		}

		// Default to broad search
		return "broad"
	}

	/**
	 * Perform broad research across all available sources
	 */
	private async performBroadResearch(task: ResearchTask): Promise<ResearchResult> {
		const startTime = Date.now()

		// Build search query
		const searchQuery: SearchQuery = {
			query: task.query,
			limit: task.maxResults || 20,
			threshold: 0.3,
		}

		// Add framework filter if specified
		if (task.framework) {
			const sources = await this.knowledgeService.getDocumentationSources()
			const frameworkSources = sources.filter(
				(s) =>
					s.name.toLowerCase().includes(task.framework!.toLowerCase()) ||
					s.metadata.tags.includes(task.framework!),
			)
			searchQuery.sourceIds = frameworkSources.map((s) => s.id)
		}

		// Execute search
		const searchResults = await this.knowledgeService.search(searchQuery)

		// Generate summaries using AI
		const summaries = await this.generateSummaries(task.query, searchResults.results)

		// Generate recommendations
		const recommendations = await this.generateRecommendations(task.query, searchResults.results, summaries)

		return {
			query: task.query,
			results: searchResults.results,
			sources: searchResults.sources,
			summaries,
			recommendations,
			confidence: this.calculateConfidence(searchResults.results),
			executionTime: Date.now() - startTime,
		}
	}

	/**
	 * Perform specific research targeting a particular framework or technology
	 */
	private async performSpecificResearch(task: ResearchTask): Promise<ResearchResult> {
		const startTime = Date.now()

		// Get all sources and filter by framework
		const allSources = await this.knowledgeService.getDocumentationSources()
		const framework = task.framework || this.extractFrameworkFromQuery(task.query)

		const relevantSources = allSources.filter(
			(source) =>
				source.name.toLowerCase().includes(framework.toLowerCase()) ||
				source.metadata.tags.includes(framework) ||
				source.source.includes(framework),
		)

		if (relevantSources.length === 0) {
			// Fallback to broad search if no specific sources found
			return await this.performBroadResearch(task)
		}

		// Build targeted search query
		const searchQuery: SearchQuery = {
			query: task.query,
			sourceIds: relevantSources.map((s) => s.id),
			limit: task.maxResults || 15,
			threshold: 0.4,
		}

		// Execute search
		const searchResults = await this.knowledgeService.search(searchQuery)

		// Generate framework-specific summaries
		const summaries = await this.generateFrameworkSpecificSummaries(framework, task.query, searchResults.results)

		// Generate targeted recommendations
		const recommendations = await this.generateFrameworkSpecificRecommendations(
			framework,
			task.query,
			searchResults.results,
			summaries,
		)

		return {
			query: task.query,
			results: searchResults.results,
			sources: searchResults.sources,
			summaries,
			recommendations,
			confidence: this.calculateConfidence(searchResults.results),
			executionTime: Date.now() - startTime,
		}
	}

	/**
	 * Perform comprehensive research with multiple passes and synthesis
	 */
	private async performComprehensiveResearch(task: ResearchTask): Promise<ResearchResult> {
		const startTime = Date.now()

		// First pass: Broad search
		const broadResults = await this.performBroadResearch({
			...task,
			maxResults: 30,
		})

		// Second pass: Deep dive into top results
		const topResults = broadResults.results.slice(0, 10)
		const deepQueries = await this.generateDeepQueries(task.query, topResults)

		const deepResults = []
		for (const deepQuery of deepQueries) {
			const deepSearch = await this.knowledgeService.search({
				query: deepQuery,
				limit: 5,
				threshold: 0.5,
			})
			deepResults.push(...deepSearch.results)
		}

		// Combine and deduplicate results
		const allResults = [...broadResults.results, ...deepResults]
		const uniqueResults = this.deduplicateResults(allResults)

		// Generate comprehensive summaries
		const summaries = await this.generateComprehensiveSummaries(task.query, uniqueResults)

		// Generate detailed recommendations
		const recommendations = await this.generateComprehensiveRecommendations(task.query, uniqueResults, summaries)

		return {
			query: task.query,
			results: uniqueResults,
			sources: broadResults.sources,
			summaries,
			recommendations,
			confidence: this.calculateConfidence(uniqueResults),
			executionTime: Date.now() - startTime,
		}
	}

	/**
	 * Generate summaries for search results using AI
	 */
	private async generateSummaries(query: string, results: any[]): Promise<string[]> {
		if (results.length === 0) return []

		const prompt = `Given the query "${query}", please provide a concise summary for each of the following search results. Focus on the most relevant information for the query.\n\n${results
			.map((result, index) => `Result ${index + 1}:\n${result.chunk.content.substring(0, 500)}...\n`)
			.join(
				"\n",
			)}\n\nPlease provide ${results.length} summaries, one for each result, in the format:\nSummary 1: [summary text]\nSummary 2: [summary text]\netc.`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 1000,
				temperature: 0.3,
			})

			// Parse the response into individual summaries
			const summaryLines = response.split("\n").filter((line) => line.trim().startsWith("Summary"))
			return summaryLines.map((line) => line.replace(/^Summary\s*\d+:\s*/, "").trim())
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate summaries:", error)
			// Fallback: return truncated content as summaries
			return results.map((result) => result.chunk.content.substring(0, 200) + "...")
		}
	}

	/**
	 * Generate framework-specific summaries
	 */
	private async generateFrameworkSpecificSummaries(
		framework: string,
		query: string,
		results: any[],
	): Promise<string[]> {
		const prompt = `As a ${framework} expert, summarize the following search results for the query "${query}". Focus on ${framework}-specific details, best practices, and implementation guidance.\n\n${results
			.map((result, index) => `Result ${index + 1}:\n${result.chunk.content.substring(0, 500)}...\n`)
			.join("\n")}\n\nProvide ${results.length} framework-specific summaries:`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 1000,
				temperature: 0.3,
			})

			const summaryLines = response.split("\n").filter((line) => line.trim())
			return summaryLines.map((line) => line.trim()).filter((line) => line.length > 0)
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate framework-specific summaries:", error)
			return await this.generateSummaries(query, results)
		}
	}

	/**
	 * Generate comprehensive summaries
	 */
	private async generateComprehensiveSummaries(query: string, results: any[]): Promise<string[]> {
		// Group results by topic/theme
		const groupedResults = this.groupResultsByTopic(results)
		const summaries: string[] = []

		for (const [topic, topicResults] of Object.entries(groupedResults)) {
			const prompt = `Create a comprehensive summary for the topic "${topic}" based on the following search results for query "${query}".\n\n${topicResults
				.map((result, index) => `Source ${index + 1}:\n${result.chunk.content.substring(0, 800)}...\n`)
				.join("\n")}\n\nProvide a detailed summary that synthesizes all information about ${topic}:`

			try {
				const response = await this.aiService.generateText(prompt, {
					maxTokens: 800,
					temperature: 0.3,
				})

				summaries.push(`${topic}: ${response.trim()}`)
			} catch (error) {
				console.warn(`[ResearchAgent] Failed to generate comprehensive summary for ${topic}:`, error)
			}
		}

		return summaries.length > 0 ? summaries : await this.generateSummaries(query, results)
	}

	/**
	 * Generate recommendations based on research results
	 */
	private async generateRecommendations(query: string, results: any[], summaries: string[]): Promise<string[]> {
		const prompt = `Based on the query "${query}" and the following research results, provide 3-5 actionable recommendations:\n\n${summaries
			.map((summary, index) => `${index + 1}. ${summary}`)
			.join(
				"\n",
			)}\n\nFormat your response as:\n1. [Recommendation 1]\n2. [Recommendation 2]\n3. [Recommendation 3]\netc.`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 600,
				temperature: 0.4,
			})

			const recommendations = response
				.split("\n")
				.filter((line) => /^\d+\./.test(line.trim()))
				.map((line) => line.replace(/^\d+\.\s*/, "").trim())

			return recommendations.slice(0, 5) // Limit to 5 recommendations
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate recommendations:", error)
			return ["Unable to generate recommendations due to an error."]
		}
	}

	/**
	 * Generate framework-specific recommendations
	 */
	private async generateFrameworkSpecificRecommendations(
		framework: string,
		query: string,
		results: any[],
		summaries: string[],
	): Promise<string[]> {
		const prompt = `As a ${framework} expert, provide 3-5 specific recommendations for the query "${query}" based on this research:\n\n${summaries
			.map((summary, index) => `${index + 1}. ${summary}`)
			.join("\n")}\n\nFocus on ${framework}-specific best practices and implementation guidance:`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 600,
				temperature: 0.4,
			})

			const recommendations = response
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => line.trim())

			return recommendations.slice(0, 5)
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate framework-specific recommendations:", error)
			return await this.generateRecommendations(query, results, summaries)
		}
	}

	/**
	 * Generate comprehensive recommendations
	 */
	private async generateComprehensiveRecommendations(
		query: string,
		results: any[],
		summaries: string[],
	): Promise<string[]> {
		const prompt = `Based on comprehensive research for "${query}", provide detailed, actionable recommendations. Consider the following summaries:\n\n${summaries
			.map((summary, index) => `${index + 1}. ${summary}`)
			.join("\n")}\n\nProvide 5-7 comprehensive recommendations with implementation guidance:`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 800,
				temperature: 0.4,
			})

			const recommendations = response
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => line.trim())

			return recommendations.slice(0, 7)
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate comprehensive recommendations:", error)
			return await this.generateRecommendations(query, results, summaries)
		}
	}

	/**
	 * Extract framework name from query
	 */
	private extractFrameworkFromQuery(query: string): string {
		const frameworks = ["odoo", "django", "react", "vue", "angular", "node", "express", "flask", "rails"]
		const queryLower = query.toLowerCase()

		for (const framework of frameworks) {
			if (queryLower.includes(framework)) {
				return framework
			}
		}

		return "generic"
	}

	/**
	 * Generate deep queries for comprehensive research
	 */
	private async generateDeepQueries(originalQuery: string, topResults: any[]): Promise<string[]> {
		const prompt = `Based on the query "${originalQuery}" and these top results, generate 3-4 specific follow-up queries for deeper research:\n\n${topResults
			.slice(0, 5)
			.map((result, index) => `${index + 1}. ${result.chunk.content.substring(0, 200)}...`)
			.join("\n")}\n\nGenerate specific queries that would help find more detailed information:`

		try {
			const response = await this.aiService.generateText(prompt, {
				maxTokens: 300,
				temperature: 0.5,
			})

			return response
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => line.trim())
				.slice(0, 4)
		} catch (error) {
			console.warn("[ResearchAgent] Failed to generate deep queries:", error)
			return [originalQuery + " examples", originalQuery + " tutorial", originalQuery + " best practices"]
		}
	}

	/**
	 * Group results by topic/theme
	 */
	private groupResultsByTopic(results: any[]): Record<string, any[]> {
		const groups: Record<string, any[]> = {}

		for (const result of results) {
			const content = result.chunk.content.toLowerCase()
			const title = result.chunk.metadata.title || ""

			// Simple topic detection based on keywords
			let topic = "general"

			if (content.includes("install") || content.includes("setup") || title.includes("installation")) {
				topic = "Installation & Setup"
			} else if (content.includes("configur") || content.includes("setting")) {
				topic = "Configuration"
			} else if (content.includes("example") || content.includes("tutorial")) {
				topic = "Examples & Tutorials"
			} else if (content.includes("api") || content.includes("method") || content.includes("function")) {
				topic = "API Reference"
			} else if (content.includes("error") || content.includes("troubleshoot")) {
				topic = "Troubleshooting"
			} else if (content.includes("best practice") || content.includes("pattern")) {
				topic = "Best Practices"
			}

			if (!groups[topic]) {
				groups[topic] = []
			}
			groups[topic].push(result)
		}

		return groups
	}

	/**
	 * Deduplicate results based on content similarity
	 */
	private deduplicateResults(results: any[]): any[] {
		const seen = new Set<string>()
		const unique = []

		for (const result of results) {
			const contentHash = this.simpleHash(result.chunk.content.substring(0, 200))
			if (!seen.has(contentHash)) {
				seen.add(contentHash)
				unique.push(result)
			}
		}

		return unique
	}

	/**
	 * Simple hash function for content deduplication
	 */
	private simpleHash(content: string): string {
		let hash = 0
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32-bit integer
		}
		return hash.toString()
	}

	/**
	 * Calculate confidence score for research results
	 */
	private calculateConfidence(results: any[]): number {
		if (results.length === 0) return 0

		// Base confidence on number of results and average relevance
		const resultCount = Math.min(results.length, 10) // Cap at 10 for calculation
		const avgScore = results.reduce((sum, result) => sum + (result.score || 0), 0) / results.length

		// Combine factors
		const confidence = (resultCount / 10) * 0.6 + avgScore * 0.4
		return Math.min(Math.max(confidence, 0), 1) // Clamp between 0 and 1
	}

	/**
	 * Update agent statistics
	 */
	private updateStats(success: boolean): void {
		// This would update the agent's internal statistics
		// Implementation depends on the BaseAgent structure
		if (success) {
			console.log("[ResearchAgent] Task completed successfully")
		} else {
			console.log("[ResearchAgent] Task failed")
		}
	}
}

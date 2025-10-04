import type { BenchmarkTestCase, BenchmarkMetrics } from "../types/BenchmarkTypes"

/**
 * Comprehensive scoring system that combines multiple evaluation approaches
 * Migrates Mark's pattern matching with additional semantic analysis
 */
export class ScoreCalculator {
	/**
	 * Calculate simplified metrics for a test result (scoring approach TBD)
	 */
	async calculateMetrics(
		testCase: BenchmarkTestCase,
		suggestions: any, // Ghost suggestions state
		actualResponse: string,
		executionTime: number,
	): Promise<BenchmarkMetrics> {
		// Simple success metric: did we get a response?
		const success = !!(actualResponse && actualResponse.length > 0)

		return {
			success,
			responseTime: executionTime,
			// Future: Add tokensUsed when available from LLM response
		}
	}

	/**
	 * Extract generated content from LLM response (handles different formats)
	 */
	private extractGeneratedContent(response: string, testCase: BenchmarkTestCase): string {
		// Handle <|code_to_edit|> format (used by some models)
		const codeEditMatch = response.match(/<\|code_to_edit\|>([\s\S]*?)<\|\/code_to_edit\|>/i)
		if (codeEditMatch) {
			return codeEditMatch[1].trim()
		}

		// Handle XML format with <change> blocks
		const changes = this.parseXMLChanges(response)
		if (changes.length > 0) {
			// Apply changes to original content
			return this.applyChangesToContent(testCase.inputContent, changes)
		}

		// Fallback: assume the entire response is the generated content
		return response.trim()
	}

	/**
	 * Check exact match between generated and expected content
	 */
	private checkExactMatch(generated: string, expected: string): boolean {
		// Normalize whitespace and line endings
		const normalizeContent = (content: string) => content.replace(/\r\n/g, "\n").replace(/\s+$/gm, "").trim()

		return normalizeContent(generated) === normalizeContent(expected)
	}

	/**
	 * Calculate semantic similarity using AST-based comparison
	 */
	private async calculateSemanticSimilarity(generated: string, expected: string): Promise<number> {
		try {
			// Simple token-based similarity as fallback
			// TODO: Implement proper AST-based comparison
			return this.calculateTokenBasedSimilarity(generated, expected)
		} catch (error) {
			console.warn("Failed to calculate semantic similarity:", error)
			return 0
		}
	}

	/**
	 * Token-based similarity calculation (simple implementation)
	 */
	private calculateTokenBasedSimilarity(generated: string, expected: string): number {
		const tokenize = (text: string) =>
			text
				.toLowerCase()
				.replace(/[^\w\s]/g, " ")
				.split(/\s+/)
				.filter((token) => token.length > 0)

		const generatedTokens = new Set(tokenize(generated))
		const expectedTokens = new Set(tokenize(expected))

		if (expectedTokens.size === 0 && generatedTokens.size === 0) {
			return 1.0
		}

		if (expectedTokens.size === 0 || generatedTokens.size === 0) {
			return 0.0
		}

		// Calculate Jaccard similarity
		const intersection = new Set([...generatedTokens].filter((token) => expectedTokens.has(token)))
		const union = new Set([...generatedTokens, ...expectedTokens])

		return intersection.size / union.size
	}

	/**
	 * Check pattern matches using regex (Mark's approach)
	 */
	private checkPatternMatches(content: string, patterns: string[]): string[] {
		const matches: string[] = []

		for (const pattern of patterns) {
			try {
				const regex = new RegExp(pattern)
				if (regex.test(content)) {
					matches.push(pattern)
				}
			} catch (error) {
				console.warn(`Invalid regex pattern: ${pattern}`, error)
			}
		}

		return matches
	}

	/**
	 * Check if generated content compiles/parses successfully
	 */
	private checkCompilationStatus(content: string, filename: string): boolean {
		try {
			// Basic syntax validation based on file type
			const extension = filename.split(".").pop()?.toLowerCase()

			switch (extension) {
				case "js":
				case "jsx":
					return this.validateJavaScript(content)
				case "ts":
				case "tsx":
					return this.validateTypeScript(content)
				case "json":
					return this.validateJSON(content)
				default:
					// For unknown types, just check for basic syntax errors
					return !this.hasObviousSyntaxErrors(content)
			}
		} catch (error) {
			return false
		}
	}

	/**
	 * Basic JavaScript syntax validation
	 */
	private validateJavaScript(content: string): boolean {
		try {
			// Use Function constructor for basic syntax check
			new Function(content)
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Basic TypeScript syntax validation
	 */
	private validateTypeScript(content: string): boolean {
		// For now, treat as JavaScript
		// TODO: Integrate with TypeScript compiler API
		return this.validateJavaScript(content)
	}

	/**
	 * JSON validation
	 */
	private validateJSON(content: string): boolean {
		try {
			JSON.parse(content)
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Check for obvious syntax errors
	 */
	private hasObviousSyntaxErrors(content: string): boolean {
		// Check for unbalanced brackets/parentheses
		const brackets = { "(": 0, "[": 0, "{": 0 }

		for (const char of content) {
			if (char === "(") brackets["("]++
			else if (char === ")") brackets["("]--
			else if (char === "[") brackets["["]++
			else if (char === "]") brackets["["]--
			else if (char === "{") brackets["{"]++
			else if (char === "}") brackets["{"]--

			// Check for negative counts (closing before opening)
			if (brackets["("] < 0 || brackets["["] < 0 || brackets["{"] < 0) {
				return true
			}
		}

		// Check if all brackets are balanced
		return brackets["("] !== 0 || brackets["["] !== 0 || brackets["{"] !== 0
	}

	/**
	 * Parse XML change blocks (Mark's XML format)
	 */
	private parseXMLChanges(xmlResponse: string): Array<{ search: string; replace: string }> {
		const changes: Array<{ search: string; replace: string }> = []

		// Parse XML response to extract change blocks
		const changeRegex =
			/<change>\s*<search><!\[CDATA\[(.*?)\]\]><\/search>\s*<replace><!\[CDATA\[(.*?)\]\]><\/replace>\s*<\/change>/gs

		let match
		while ((match = changeRegex.exec(xmlResponse)) !== null) {
			changes.push({
				search: match[1],
				replace: match[2],
			})
		}

		return changes
	}

	/**
	 * Apply XML changes to content
	 */
	private applyChangesToContent(
		originalContent: string,
		changes: Array<{ search: string; replace: string }>,
	): string {
		let modifiedContent = originalContent

		for (const change of changes) {
			modifiedContent = modifiedContent.replace(change.search, change.replace)
		}

		return modifiedContent
	}

	/**
	 * Extract Ghost-specific metrics from suggestions state
	 */
	private extractGhostMetrics(suggestions: any): {
		groupCount: number
		selectedGroup: number
		displayMode: "inline" | "decorator" | undefined
	} {
		if (!suggestions) {
			return {
				groupCount: 0,
				selectedGroup: -1,
				displayMode: undefined,
			}
		}

		// TODO: Extract actual metrics from GhostSuggestionsState
		// This requires proper integration with the Ghost system
		return {
			groupCount: 0,
			selectedGroup: 0,
			displayMode: undefined,
		}
	}
}

/**
 * Intelligent Model Router for Gemini CLI Provider
 *
 * Automatically selects optimal models based on task complexity.
 * Simple tasks use gemini-2.5-flash (faster, cheaper)
 * Complex tasks use gemini-2.5-pro (more capable)
 *
 * Pattern based on Gemini CLI v0.11.2+ graduation
 * https://github.com/google-gemini/gemini-cli/discussions/12375
 */

export interface RoutingResult {
	selectedModel: "gemini-2.5-flash" | "gemini-2.5-pro"
	complexity: number // 0-100
	reasoning: string
	originalModel?: string // The model that was originally selected
}

export interface RoutingConfig {
	enabled: boolean
	simpleThreshold: number // Default: 50
	showComplexity: boolean
}

const DEFAULT_CONFIG: RoutingConfig = {
	enabled: true,
	simpleThreshold: 50,
	showComplexity: true,
}

/**
 * Routes a task to the optimal Gemini model based on complexity
 */
export async function routeGeminiModel(task: string, config: Partial<RoutingConfig> = {}): Promise<RoutingResult> {
	const finalConfig = { ...DEFAULT_CONFIG, ...config }

	if (!finalConfig.enabled) {
		// If routing is disabled, default to pro
		return {
			selectedModel: "gemini-2.5-pro",
			complexity: 100,
			reasoning: "Routing disabled, using pro model",
		}
	}

	const complexity = detectComplexity(task)
	const selectedModel = complexity < finalConfig.simpleThreshold ? "gemini-2.5-flash" : "gemini-2.5-pro"

	return {
		selectedModel,
		complexity,
		reasoning: `${complexity}% complexity → ${selectedModel}`,
	}
}

/**
 * Detects task complexity on a scale of 0-100
 *
 * Complexity signals (increase score):
 * - Keywords: system, architecture, design, algorithm, refactor, optimize, debug, analyze
 * - Long task descriptions (>500 chars)
 * - Multiple components mentioned
 *
 * Simplicity signals (decrease score):
 * - Keywords: write, test, fix, typo, format, simple, quick
 * - Short task descriptions (<50 chars)
 * - Single file/component focus
 */
export function detectComplexity(task: string): number {
	if (!task || task.trim().length === 0) {
		return 50 // neutral score for empty tasks
	}

	const taskLower = task.toLowerCase()

	// Keywords that indicate complexity
	const complexKeywords = [
		"system",
		"architecture",
		"design",
		"algorithm",
		"refactor",
		"optimize",
		"debug",
		"analyze",
		"complex",
		"large-scale",
		"distributed",
		"microservices",
		"performance",
		"scalability",
		"scalable",
		"security",
		"integration",
		"migration",
		"restructure",
		"overhaul",
		"redesign",
		"authentication",
		"authorization",
		"oauth",
		"implement",
	]

	// Keywords that indicate simplicity
	const simpleKeywords = [
		"write",
		"test",
		"fix",
		"typo",
		"format",
		"simple",
		"quick",
		"small",
		"add",
		"update",
		"comment",
		"documentation",
		"readme",
		"log",
		"print",
		"display",
		"show",
		"rename",
	]

	// Start with base score
	let score = 50

	// Adjust by complex keywords (max +10 per keyword, cap at +40)
	let complexMatches = 0
	for (const keyword of complexKeywords) {
		// Use word boundary matching to avoid false positives
		const regex = new RegExp(`\\b${keyword}\\b`, "i")
		if (regex.test(task)) {
			complexMatches++
			score += 10
		}
	}
	if (complexMatches * 10 > 40) {
		score = 50 + 40 // cap complex bonus
	}

	// Adjust by simple keywords (max -10 per keyword, cap at -40)
	let simpleMatches = 0
	for (const keyword of simpleKeywords) {
		// Use word boundary matching to avoid false positives
		const regex = new RegExp(`\\b${keyword}\\b`, "i")
		if (regex.test(task)) {
			simpleMatches++
			score -= 10
		}
	}
	if (simpleMatches * 10 > 40) {
		score += simpleMatches * 10 - 40 // Add back the excess penalty
	}

	// Adjust by task length
	const taskLength = task.length
	if (taskLength > 500) {
		score += 15 // Long tasks tend to be complex
	} else if (taskLength > 200) {
		score += 5 // Medium tasks slightly more complex
	} else if (taskLength < 50) {
		score -= 15 // Very short tasks tend to be simple
	} else if (taskLength < 100) {
		score -= 5 // Shortish tasks slightly simpler
	}

	// Check for multiple components/files (indicates complexity)
	const fileExtensions = [".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rb", ".php", ".cs"]
	let fileCount = 0
	for (const ext of fileExtensions) {
		const matches = task.match(new RegExp(`\\${ext}`, "g"))
		if (matches) {
			fileCount += matches.length
		}
	}
	if (fileCount > 3) {
		score += 15 // Multiple files indicates complexity
	} else if (fileCount > 1) {
		score += 5
	}

	// Check for lists or multiple steps (indicates complexity)
	const numberedListMatches = task.match(/\d+\.\s/g)
	const bulletListMatches = task.match(/[-*]\s/g)
	const listItemCount = (numberedListMatches?.length || 0) + (bulletListMatches?.length || 0)
	if (listItemCount > 0) {
		// Base bonus for having a list + bonus per item (capped at 5 items)
		score += 15 + Math.min(listItemCount, 5) * 5
	}

	// Check for code blocks (indicates technical complexity)
	const hasCodeBlock = /```/.test(task)
	if (hasCodeBlock) {
		score += 10
	}

	// Clamp score to 0-100 range
	return Math.max(0, Math.min(100, score))
}

/**
 * Determines if a model should use intelligent routing
 * Only Gemini CLI models with both flash and pro variants should route
 */
export function shouldRouteModel(modelId: string): boolean {
	// Only route for gemini-2.5-* models
	return modelId.startsWith("gemini-2.5-") || modelId === "gemini-2.0-flash-thinking-exp-01-21"
}

/**
 * Gets the appropriate fallback model if the routed model is unavailable
 */
export function getFallbackModel(requestedModel: string): string {
	if (requestedModel === "gemini-2.5-flash") {
		return "gemini-2.5-pro" // Fall back to pro if flash unavailable
	}
	return "gemini-2.5-flash" // Fall back to flash if pro unavailable
}

/**
 * EditAnalyzer Service
 *
 * Analyzes codebase to identify locations requiring edits based on user goals.
 * Uses hybrid approach combining semantic language server analysis with pattern matching.
 *
 * @module EditAnalyzer
 */

import type * as vscode from "vscode"
import type { EditSuggestion, EditContext, EditCategory, AnalysisMethod } from "./types"
import { createAnalysisFailedError } from "./errors"
import { generateUUID } from "./utils"
import * as crypto from "crypto"

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message with timestamp
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
	const timestamp = new Date().toISOString()
	const logMessage = `[${timestamp}] [EditAnalyzer] [${level.toUpperCase()}] ${message}`

	if (level === "error") {
		console.error(logMessage, data)
	} else if (level === "warn") {
		console.warn(logMessage, data)
	} else {
		console.log(logMessage, data)
	}
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Cache entry for analysis results
 */
interface CacheEntry<T> {
	data: T
	timestamp: number
	ttl: number // Time to live in milliseconds
}

/**
 * Simple in-memory cache with TTL support
 */
class AnalysisCache<T> {
	private cache = new Map<string, CacheEntry<T>>()
	private defaultTTL: number

	constructor(defaultTTL: number = 5 * 60 * 1000) {
		// 5 minutes default
		this.defaultTTL = defaultTTL
	}

	set(key: string, data: T, ttl?: number): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			ttl: ttl || this.defaultTTL,
		})
	}

	get(key: string): T | null {
		const entry = this.cache.get(key)
		if (!entry) return null

		const now = Date.now()
		const age = now - entry.timestamp

		if (age > entry.ttl) {
			this.cache.delete(key)
			return null
		}

		return entry.data
	}

	has(key: string): boolean {
		return this.get(key) !== null
	}

	clear(): void {
		this.cache.clear()
	}

	cleanExpired(): void {
		const now = Date.now()
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > entry.ttl) {
				this.cache.delete(key)
			}
		}
	}

	get size(): number {
		return this.cache.size
	}
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Configuration options for codebase analysis
 */
export interface AnalysisOptions {
	/** Glob patterns for files to include */
	includePatterns?: string[]
	/** Glob patterns for files to exclude */
	excludePatterns?: string[]
	/** Maximum number of files to analyze */
	maxFiles?: number
	/** Whether to use semantic analysis */
	useSemanticAnalysis?: boolean
	/** Whether to use pattern matching */
	usePatternMatching?: boolean
}

/**
 * Result of codebase analysis
 */
export interface AnalysisResult {
	/** Generated edit suggestions */
	edits: EditSuggestion[]
	/** Total files analyzed */
	totalFiles: number
	/** Estimated time to complete all edits (seconds) */
	estimatedTime: number
}

/**
 * Interface for EditAnalyzer service
 */
export interface IEditAnalyzer {
	/**
	 * Analyzes the codebase to identify edit locations
	 *
	 * @param workspaceUri - VSCode workspace URI
	 * @param goal - User's edit goal description
	 * @param options - Analysis configuration options
	 * @returns Promise with analysis results
	 */
	analyzeCodebase(workspaceUri: string, goal: string, options?: AnalysisOptions): Promise<AnalysisResult>

	/**
	 * Generates edit suggestions from analysis results
	 *
	 * @param analysisData - Raw analysis data
	 * @param sessionId - Parent session ID
	 * @returns Promise with generated edit suggestions
	 */
	generateEditSuggestions(analysisData: unknown, sessionId: string): Promise<EditSuggestion[]>

	/**
	 * Calculates confidence score for an edit suggestion
	 *
	 * @param edit - The edit suggestion to evaluate
	 * @returns Confidence score between 0 and 1
	 */
	calculateConfidence(edit: EditSuggestion): number

	/**
	 * Generates context metadata for an edit
	 *
	 * @param edit - The edit suggestion
	 * @param fileContent - Content of the file being edited
	 * @returns Promise with edit context
	 */
	generateContext(edit: EditSuggestion, fileContent: string): Promise<EditContext>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * EditAnalyzer implementation
 */
export class EditAnalyzer implements IEditAnalyzer {
	private analysisCache: AnalysisCache<unknown>
	private contextCache: AnalysisCache<EditContext>
	private readonly CACHE_TTL = 10 * 60 * 1000 // 10 minutes

	constructor(private readonly context: vscode.ExtensionContext) {
		this.analysisCache = new AnalysisCache(this.CACHE_TTL)
		this.contextCache = new AnalysisCache(this.CACHE_TTL)

		// Clean expired cache entries every 5 minutes
		setInterval(
			() => {
				this.analysisCache.cleanExpired()
				this.contextCache.cleanExpired()
			},
			5 * 60 * 1000,
		)
	}

	async analyzeCodebase(workspaceUri: string, goal: string, options?: AnalysisOptions): Promise<AnalysisResult> {
		const startTime = Date.now()

		try {
			// Validate inputs
			if (!workspaceUri) {
				log("error", "Cannot analyze codebase: workspace URI is required")
				throw new Error("Workspace URI is required. Please provide a valid workspace path.")
			}
			if (!goal || goal.trim().length === 0) {
				log("error", "Cannot analyze codebase: goal is required")
				throw new Error("Goal is required. Please describe what you want to accomplish.")
			}

			// Generate cache key based on workspace, goal, and options
			const cacheKey = this.generateCacheKey(workspaceUri, goal, options)

			// Check cache first
			if (this.analysisCache.has(cacheKey)) {
				log("info", "Using cached analysis results", { cacheKey })
				const cachedResult = this.analysisCache.get(cacheKey) as AnalysisResult
				return cachedResult
			}

			log("info", "Starting codebase analysis", { workspaceUri, goal, options })

			const analysisOptions = {
				includePatterns: options?.includePatterns || ["**/*.{ts,tsx,js,jsx,py,java}"],
				excludePatterns: options?.excludePatterns || ["**/node_modules/**", "**/dist/**", "**/build/**"],
				maxFiles: options?.maxFiles || 1000,
				useSemanticAnalysis: options?.useSemanticAnalysis ?? true,
				usePatternMatching: options?.usePatternMatching ?? true,
			}

			log("info", "Analysis options configured", analysisOptions)

			// Perform analysis
			log("info", "Performing semantic analysis")
			const semanticResults = analysisOptions.useSemanticAnalysis
				? await this.performSemanticAnalysis(workspaceUri, goal, analysisOptions)
				: null

			log("info", "Performing pattern matching analysis")
			const patternResults = analysisOptions.usePatternMatching
				? await this.performPatternMatching(workspaceUri, goal, analysisOptions)
				: null

			// Combine results
			const combinedData = this.combineAnalysisResults(semanticResults, patternResults)

			// Generate edit suggestions
			log("info", "Generating edit suggestions from analysis results")
			const edits = await this.generateEditSuggestions(combinedData, "temp-session")

			// Calculate estimated time (rough estimate: 30 seconds per edit)
			const estimatedTime = edits.length * 30
			const duration = Date.now() - startTime

			const result: AnalysisResult = {
				edits,
				totalFiles: this.countFilesInAnalysis(combinedData),
				estimatedTime,
			}

			// Cache the result
			this.analysisCache.set(cacheKey, result)

			log("info", "Codebase analysis completed", {
				editsFound: edits.length,
				totalFiles: this.countFilesInAnalysis(combinedData),
				estimatedTime,
				duration: `${duration}ms`,
				cached: true,
			})

			return result
		} catch (error) {
			const duration = Date.now() - startTime
			log("error", `Codebase analysis failed after ${duration}ms`, error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw createAnalysisFailedError(
				error instanceof Error ? error.message : "Unknown error occurred during analysis",
			)
		}
	}

	async generateEditSuggestions(analysisData: unknown, sessionId: string): Promise<EditSuggestion[]> {
		try {
			if (!sessionId) {
				throw new Error("Session ID is required")
			}

			const data = analysisData as {
				files?: Array<{
					path: string
					issues?: Array<{
						line: number
						type: string
						description: string
						original?: string
						suggested?: string
					}>
				}>
			}

			if (!data?.files) {
				return []
			}

			const edits: EditSuggestion[] = []

			for (const file of data.files) {
				if (!file.issues) continue

				for (const issue of file.issues) {
					try {
						const edit: EditSuggestion = {
							id: generateUUID(),
							sessionId,
							filePath: file.path,
							lineStart: issue.line,
							lineEnd: issue.line,
							originalContent: issue.original || "// Original code",
							suggestedContent: issue.suggested || "// Suggested code",
							rationale: issue.description,
							confidence: this.calculateConfidenceFromIssue(issue),
							dependencies: [],
							dependents: [],
							status: "pending" as any,
							language: this.detectLanguage(file.path),
							category: this.mapIssueToCategory(issue.type) as EditCategory,
							priority: 1,
						}

						edits.push(edit)
					} catch (error) {
						console.warn(`Failed to generate edit suggestion for file ${file.path}: ${error}`)
						continue
					}
				}
			}

			return edits
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to generate edit suggestions: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	calculateConfidence(edit: EditSuggestion): number {
		let confidence = 0.5 // Base confidence

		// Increase confidence if rationale is detailed
		if (edit.rationale && edit.rationale.length > 50) {
			confidence += 0.2
		}

		// Increase confidence if original and suggested content are different
		if (edit.originalContent !== edit.suggestedContent) {
			confidence += 0.2
		}

		// Increase confidence if category is refactor or fix
		if (edit.category === "refactor" || edit.category === "fix") {
			confidence += 0.1
		}

		// Increase confidence for clear, well-defined edits (with both original and suggested content)
		if (
			edit.originalContent &&
			edit.suggestedContent &&
			edit.originalContent.length > 0 &&
			edit.suggestedContent.length > 0
		) {
			confidence += 0.1
		}

		// Decrease confidence for ambiguous edits (vague rationale or unclear content)
		if (edit.rationale && edit.rationale.includes("?")) {
			confidence -= 0.2
		}
		if (edit.rationale && edit.rationale.includes("Maybe")) {
			confidence -= 0.1
		}

		// Ensure confidence is between 0 and 1
		return Math.min(Math.max(confidence, 0), 1)
	}

	async generateContext(edit: EditSuggestion, fileContent: string): Promise<EditContext> {
		try {
			if (!edit) {
				throw new Error("Edit is required")
			}
			if (!fileContent) {
				throw new Error("File content is required")
			}

			// Generate cache key for context
			const contextKey = `${edit.id}-${this.calculateFileHash(fileContent)}`

			// Check cache first
			if (this.contextCache.has(contextKey)) {
				log("info", "Using cached context", { editId: edit.id })
				return this.contextCache.get(contextKey)!
			}

			const lines = fileContent.split("\n")
			const contextLines = this.extractSurroundingLines(lines, edit.lineStart, edit.lineEnd)

			const context: EditContext = {
				id: generateUUID(),
				editId: edit.id,
				functionName: this.detectFunctionName(lines, edit.lineStart),
				className: this.detectClassName(lines, edit.lineStart),
				moduleName: this.detectModuleName(edit.filePath),
				surroundingLines: contextLines,
				imports: this.extractImports(lines),
				exports: this.extractExports(lines),
				analysisMethod: "hybrid" as AnalysisMethod,
				matchedPattern: undefined,
				semanticScore: 0.8,
				fileHash: this.calculateFileHash(fileContent),
			}

			// Cache the context
			this.contextCache.set(contextKey, context)

			return context
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to generate context for edit ${edit?.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Performs semantic analysis using language server
	 */
	private async performSemanticAnalysis(
		workspaceUri: string,
		goal: string,
		options: AnalysisOptions,
	): Promise<unknown> {
		// For MVP, return mock data
		// In production, this would use VSCode language server APIs
		return {
			files: [],
			method: "semantic",
		}
	}

	/**
	 * Performs pattern matching analysis
	 */
	private async performPatternMatching(
		workspaceUri: string,
		goal: string,
		options: AnalysisOptions,
	): Promise<unknown> {
		// For MVP, return mock data
		// In production, this would use regex patterns to find code issues
		return {
			files: [],
			method: "pattern",
		}
	}

	/**
	 * Combines semantic and pattern matching results
	 */
	private combineAnalysisResults(semanticResults: unknown, patternResults: unknown): unknown {
		const semantic = (semanticResults as { files?: unknown[] }) || {}
		const pattern = (patternResults as { files?: unknown[] }) || {}

		return {
			files: [...(semantic.files || []), ...(pattern.files || [])],
		}
	}

	/**
	 * Counts files in analysis data
	 */
	private countFilesInAnalysis(data: unknown): number {
		const analysisData = data as { files?: unknown[] }
		return analysisData.files?.length || 0
	}

	/**
	 * Calculates confidence from issue data
	 */
	private calculateConfidenceFromIssue(issue: { type: string; description: string }): number {
		let confidence = 0.5

		if (issue.type === "error") confidence += 0.3
		if (issue.type === "warning") confidence += 0.2
		if (issue.type === "suggestion") confidence += 0.1

		if (issue.description.length > 100) confidence += 0.1

		return Math.min(confidence, 1)
	}

	/**
	 * Detects language from file path
	 */
	private detectLanguage(filePath: string): string {
		const ext = filePath.split(".").pop()?.toLowerCase()
		const languageMap: Record<string, string> = {
			ts: "typescript",
			tsx: "typescript",
			js: "javascript",
			jsx: "javascript",
			py: "python",
			java: "java",
			cpp: "cpp",
			c: "c",
			go: "go",
			rs: "rust",
		}
		return languageMap[ext || ""] || "unknown"
	}

	/**
	 * Maps issue type to edit category
	 */
	private mapIssueToCategory(type: string): string {
		const categoryMap: Record<string, string> = {
			error: "fix",
			warning: "fix",
			suggestion: "refactor",
			style: "style",
			upgrade: "upgrade",
		}
		return categoryMap[type] || "refactor"
	}

	/**
	 * Extracts surrounding lines for context
	 */
	private extractSurroundingLines(lines: string[], lineStart: number, lineEnd: number): string[] {
		const contextSize = 5
		const start = Math.max(0, lineStart - contextSize - 1)
		const end = Math.min(lines.length, lineEnd + contextSize)
		return lines.slice(start, end)
	}

	/**
	 * Detects function name from surrounding code
	 */
	private detectFunctionName(lines: string[], line: number): string | undefined {
		const context = lines.slice(Math.max(0, line - 10), line + 10).join("\n")
		const functionMatch = context.match(/(?:function|const|let|var)\s+(\w+)\s*=/)
		return functionMatch?.[1]
	}

	/**
	 * Detects class name from surrounding code
	 */
	private detectClassName(lines: string[], line: number): string | undefined {
		const context = lines.slice(Math.max(0, line - 20), line + 5).join("\n")
		const classMatch = context.match(/class\s+(\w+)/)
		return classMatch?.[1]
	}

	/**
	 * Detects module name from file path
	 */
	private detectModuleName(filePath: string): string | undefined {
		const parts = filePath.split("/")
		const fileName = parts[parts.length - 1]
		return fileName?.replace(/\.(ts|tsx|js|jsx|py|java)$/, "")
	}

	/**
	 * Extracts import statements
	 */
	private extractImports(lines: string[]): string[] {
		return lines
			.filter((line) => line.trim().startsWith("import ") || line.trim().startsWith("require("))
			.slice(0, 10)
	}

	/**
	 * Extracts export statements
	 */
	private extractExports(lines: string[]): string[] {
		return lines.filter((line) => line.trim().startsWith("export ")).slice(0, 10)
	}

	/**
	 * Calculates file hash
	 */
	private calculateFileHash(content: string): string {
		return crypto.createHash("md5").update(content).digest("hex")
	}

	/**
	 * Generates a cache key from analysis parameters
	 */
	private generateCacheKey(workspaceUri: string, goal: string, options?: AnalysisOptions): string {
		const optionsStr = JSON.stringify(options || {})
		return crypto.createHash("md5").update(`${workspaceUri}:${goal}:${optionsStr}`).digest("hex")
	}

	/**
	 * Clears all cached data
	 */
	public clearCache(): void {
		this.analysisCache.clear()
		this.contextCache.clear()
		log("info", "All caches cleared")
	}

	/**
	 * Gets cache statistics
	 */
	public getCacheStats(): { analysisCacheSize: number; contextCacheSize: number } {
		return {
			analysisCacheSize: this.analysisCache.size,
			contextCacheSize: this.contextCache.size,
		}
	}
}

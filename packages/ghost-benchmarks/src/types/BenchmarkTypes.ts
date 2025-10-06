import type { GhostSuggestionsState } from "../../../../src/services/ghost/GhostSuggestions"
import type { GhostProfile } from "../../../../src/services/ghost/profiles/GhostProfile"

// Standard cursor marker (U+2423 OPEN BOX)
export const CURSOR_MARKER = "␣"

// Test case metadata structure (simplified to essentials)
export interface TestCaseMetadata {
	name: string
	description: string
	category: string
}

// File mapping for multi-file test cases
export interface FileMap {
	[filename: string]: string
}

// Complete test case data structure
export interface BenchmarkTestCase {
	// Multi-file inputs
	inputFiles: FileMap
	activeFile: string
	inputContent: string // Content of active file with cursor removed
	cursorPosition: { line: number; character: number }

	// Expected data (optional - for future scoring)
	expectedFiles?: FileMap
	expectedContent?: string // Expected content for active file

	// Metadata
	metadata: TestCaseMetadata
}

// Individual benchmark result
export interface BenchmarkResult {
	testCase: BenchmarkTestCase
	profile?: GhostProfile

	// Execution results
	passed: boolean
	suggestions?: GhostSuggestionsState
	executionTime: number

	// Raw LLM response for debugging/analysis
	rawResponse?: string

	// Final file content after applying all suggestions
	finalFileContent?: string

	// Scoring metrics
	metrics: BenchmarkMetrics

	// Error information
	error?: string
	stackTrace?: string
}

// Simplified scoring metrics (scoring approach TBD)
export interface BenchmarkMetrics {
	// Basic execution metrics
	responseTime: number // API call duration (ms)
	success: boolean // Whether test passed

	// Optional performance tracking
	tokensUsed?: number // For cost tracking and optimization

	// Future: Add scoring fields when approach is determined
	// semanticSimilarity?: number
	// exactMatch?: boolean
}

// Summary of benchmark run
export interface BenchmarkSummary {
	totalTests: number
	passedTests: number
	failedTests: number
	passRate: number

	// Performance stats
	totalExecutionTime: number
	averageExecutionTime: number

	// Metrics aggregation
	averageSemanticSimilarity: number
	totalTokensUsed: number

	// Results breakdown
	results: BenchmarkResult[]

	// Error summary
	errors: { testName: string; error: string }[]
}

// Benchmark execution options
export interface BenchmarkOptions {
	profile?: GhostProfile | string // Ghost profile or profile name
	testCases?: string[] // Specific test cases to run
	categories?: string[] // Test categories to run
	timeout?: number // Global timeout override
	verbose?: boolean // Detailed logging
	outputFormat?: "console" | "json" | "html"
	outputFile?: string // Output file path
	autoSave?: boolean // Auto-save results (default: true)
}

// LLM API response structure (from Mark's system)
export interface LLMResponse {
	content: string
	provider: string
	model: string
	tokensUsed?: number
}

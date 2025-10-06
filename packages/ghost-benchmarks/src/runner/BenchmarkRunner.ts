import type {
	BenchmarkTestCase,
	BenchmarkResult,
	BenchmarkSummary,
	BenchmarkOptions,
	BenchmarkMetrics,
} from "../types/BenchmarkTypes"
import { TestCaseLoader } from "./TestCaseLoader"
import { ScoreCalculator } from "../evaluation/ScoreCalculator"
import { ResultStorage } from "../storage/ResultStorage"
import { GhostEngine } from "../../../../src/services/ghost/GhostEngine"
import { NodeGhostAdapter } from "../adapters/NodeGhostAdapter"
import { ProviderSettingsManager } from "../../../../src/core/config/ProviderSettingsManager"
import { GhostProfileManager } from "../../../../src/services/ghost/profiles/GhostProfileManager"
import { StringGhostApplicator } from "../../../../src/services/ghost/applicators/StringGhostApplicator"

// Simple mock for GhostDocumentStore to avoid import issues in benchmark environment
class MockGhostDocumentStore {
	async storeDocument() {}
	parseDocumentAST() {}
	getAST() {
		return undefined
	}
	getDocument() {
		return undefined
	}
	needsASTUpdate() {
		return false
	}
	clearAST() {}
	removeDocument() {}
	clearAllASTs() {}
	getRecentOperations() {
		return []
	}
}

/**
 * Core benchmark runner that orchestrates test execution
 * Uses real Ghost system components for accurate benchmarking
 */
export class BenchmarkRunner {
	private testCaseLoader: TestCaseLoader
	private scoreCalculator: ScoreCalculator
	private resultStorage: ResultStorage
	private mockProviderSettingsManager: ProviderSettingsManager
	private mockWorkspace: ReturnType<typeof NodeGhostAdapter.createMockWorkspace>

	constructor(options?: { testCasesDir?: string; resultsDir?: string }) {
		this.testCaseLoader = new TestCaseLoader(options?.testCasesDir)
		this.scoreCalculator = new ScoreCalculator()
		this.resultStorage = new ResultStorage(options?.resultsDir)

		// Create mock dependencies once - these can be reused
		this.mockProviderSettingsManager = this.createMockProviderSettingsManager()
		this.mockWorkspace = NodeGhostAdapter.createMockWorkspace()
	}

	/**
	 * Create mock ProviderSettingsManager for benchmark environment
	 */
	private createMockProviderSettingsManager(): ProviderSettingsManager {
		// Return a mock object that provides OpenRouter profile for all strategies
		return {
			listConfig: async () => [
				{
					id: "mock-openrouter-profile",
					name: "Mock OpenRouter",
					apiProvider: "openrouter",
					modelId: "inception/mercury-coder", // Default, will be overridden by profiles
				},
			],
			load: async () => ({ apiConfigs: {} }),
			saveConfig: async () => "mock-id",
			getConfig: async () => null,
			deleteConfig: async () => {},
			getModeConfigId: async () => null,
			setModeConfig: async () => {},
			getProfile: async (options?: { id?: string }) => ({
				id: options?.id || "mock-openrouter-profile",
				name: "Mock OpenRouter",
				apiProvider: "openrouter",
				modelId: "inception/mercury-coder", // Default, will be overridden by profiles
				openRouterApiKey: process.env.OPENROUTER_API_KEY || "mock-openrouter-key",
			}),
			activateProfile: async () => ({
				id: "mock-openrouter-profile",
				name: "Mock OpenRouter",
				apiProvider: "openrouter",
				modelId: "inception/mercury-coder",
				openRouterApiKey: process.env.OPENROUTER_API_KEY || "mock-openrouter-key",
			}),
			import: async () => ({ success: true }),
			export: async () => ({}),
		} as any
	}

	/**
	 * Initialize benchmark-specific Ghost profiles with different models and strategies
	 */
	private async initializeBenchmarkProfiles(): Promise<void> {
		// This is called in constructor - just set up the promise for later
		return Promise.resolve()
	}

	/**
	 * Create and configure a fresh GhostEngine instance for a test
	 */
	private async createFreshGhostEngine(): Promise<GhostEngine> {
		// Create fresh instances for complete isolation
		const mockDocumentStore = new MockGhostDocumentStore()
		const ghostEngine = new GhostEngine(this.mockProviderSettingsManager, mockDocumentStore as any)

		// Load the engine with enableCustomProvider = false to use the new system
		await ghostEngine.load({ enableCustomProvider: false })

		// Get the profile manager from the fresh GhostEngine
		const engineProfileManager = ghostEngine.getProfileManager()

		// Create Mercury profile - Mercury Coder model with Mercury strategy
		await engineProfileManager.createProfile({
			id: "mercury",
			name: "Mercury Coder",
			description: "Mercury Coder model with Mercury strategy",
			apiProfileId: "mock-openrouter-profile",
			promptStrategyType: "mercury",
			isDefault: true,
			customSettings: {
				openRouterModelId: "inception/mercury-coder",
			},
		})

		// Create Hole-Filler profile - GPT-4o mini with hole-filler strategy
		await engineProfileManager.createProfile({
			id: "hole-filler",
			name: "Hole Filler",
			description: "GPT-4o mini with hole-filler strategy",
			apiProfileId: "mock-openrouter-profile",
			promptStrategyType: "hole-filler",
			isDefault: false,
			customSettings: {
				openRouterModelId: "openai/gpt-4o-mini",
			},
		})

		// Create FIM profile - Mistral Codestral with FIM strategy
		await engineProfileManager.createProfile({
			id: "fim",
			name: "FIM Coder",
			description: "Mistral Codestral 2508 - specialized code completion model with native FIM support",
			apiProfileId: "mock-openrouter-profile",
			promptStrategyType: "fim",
			isDefault: false,
			customSettings: {
				openRouterModelId: "mistralai/codestral-2508",
			},
		})

		// Create Legacy-XML profile - Claude 3.5 Sonnet with legacy XML strategy
		await engineProfileManager.createProfile({
			id: "legacy-xml",
			name: "Legacy XML",
			description: "Claude 3.5 Sonnet with legacy XML strategy for precise instruction following",
			apiProfileId: "mock-openrouter-profile",
			promptStrategyType: "legacy-xml",
			isDefault: false,
			customSettings: {
				openRouterModelId: "anthropic/claude-3.5-sonnet",
			},
		})

		console.log("✅ Initialized 4 benchmark profiles with different models and strategies")
		return ghostEngine
	}

	/**
	 * Run single test case using real Ghost system with fresh engine instance
	 */
	async runTestCase(testCase: BenchmarkTestCase, options: BenchmarkOptions): Promise<BenchmarkResult> {
		try {
			console.log(`🧪 Running test: ${testCase.metadata.name}`)

			if (!options.profile || typeof options.profile !== "string") {
				throw new Error("Profile name required for test execution")
			}

			// Create a fresh GhostEngine instance for complete test isolation
			const ghostEngine = await this.createFreshGhostEngine()

			// Create benchmark context using NodeGhostAdapter
			const { engineContext, mockDocument } = NodeGhostAdapter.createBenchmarkContext(testCase)

			// Get the Ghost profile for this benchmark from the engine's profile manager
			const engineProfileManager = ghostEngine.getProfileManager()
			const ghostProfile = engineProfileManager.getProfile(options.profile)
			if (!ghostProfile) {
				// Debug: List all available profiles
				const engineProfiles = ghostEngine.getProfileManager().getAllProfiles()
				const engineProfileIds = engineProfiles.map((p) => p.id)
				console.log(`Engine profiles: ${engineProfileIds.join(", ")}`)

				throw new Error(
					`Ghost profile not found: ${options.profile}. Available: ${engineProfileIds.join(", ")}`,
				)
			}

			// Get profile summary for logging
			const summary = ghostProfile.getSummary()
			console.log(
				`🤖 Using profile: ${summary.name} (${summary.modelName || "unknown model"}) with ${summary.strategyName || "unknown strategy"} strategy`,
			)

			// Switch the GhostEngine to use the correct profile
			const profileSwitched = await ghostEngine.switchProfile(options.profile)
			if (!profileSwitched) {
				throw new Error(`Failed to switch to profile: ${options.profile}`)
			}

			// Set quiet mode for benchmarks to reduce noise
			// process.env.GHOST_QUIET_MODE = "true"

			// Execute through REAL GhostEngine (now using the correct profile)
			const startTime = Date.now()
			// Use StringGhostApplicator for benchmarks (no actual file modification needed)
			const applicator = new StringGhostApplicator()
			const result = await ghostEngine.executeCompletion(engineContext, applicator, "none")
			const executionTime = Date.now() - startTime

			// Apply all suggestions to get final file content
			let finalFileContent = testCase.inputFiles[testCase.activeFile] || ""

			// Log input file content
			console.log("\n📄 Input file content:")
			console.log("".padEnd(60, "="))
			console.log(finalFileContent)
			console.log("".padEnd(60, "="))

			if (result.suggestions.hasSuggestions()) {
				const primaryFile = result.suggestions.getPrimaryFile()
				if (primaryFile) {
					finalFileContent = this.applyAllSuggestions(finalFileContent, primaryFile)
				}
			}

			// Log final file content after applying suggestions
			console.log("\n📄 Final file content after applying all suggestions:")
			console.log("".padEnd(60, "="))
			console.log(finalFileContent)
			console.log("".padEnd(60, "="))

			// Cleanup quiet mode
			delete process.env.GHOST_QUIET_MODE

			// Calculate simple metrics
			const metrics = await this.scoreCalculator.calculateMetrics(
				testCase,
				result.suggestions,
				result.rawResponse || "",
				result.executionTime,
			)

			// Determine pass/fail based on whether suggestions were generated
			const passed = result.suggestions.hasSuggestions()

			return {
				testCase,
				profile: undefined, // Avoid circular reference in OpenAI client
				passed,
				suggestions: result.suggestions,
				executionTime: result.executionTime,
				rawResponse: result.rawResponse,
				metrics,
				finalFileContent, // Include final content in result
			}
		} catch (error) {
			console.error(`❌ Test failed: ${testCase.metadata.name}`, error)

			return {
				testCase,
				passed: false,
				executionTime: 0,
				metrics: this.createErrorMetrics(),
				error: error instanceof Error ? error.message : String(error),
				stackTrace: error instanceof Error ? error.stack : undefined,
			}
		}
	}

	/**
	 * Run multiple test cases
	 */
	async runTestCases(testCases: BenchmarkTestCase[], options: BenchmarkOptions): Promise<BenchmarkSummary> {
		const startTime = Date.now()
		const results: BenchmarkResult[] = []
		const errors: { testName: string; error: string }[] = []

		console.log(`🚀 Starting benchmark run: ${testCases.length} test cases`)
		if (options.profile) {
			const profileName = typeof options.profile === "string" ? options.profile : options.profile.name
			console.log(`🤖 Profile: ${profileName}`)
		}

		for (const testCase of testCases) {
			try {
				const result = await this.runTestCase(testCase, options)
				results.push(result)

				if (result.passed) {
					console.log(`  ✅ PASS ${testCase.metadata.name} (${result.executionTime}ms)`)
				} else {
					console.log(`  ❌ FAIL ${testCase.metadata.name} (${result.executionTime}ms)`)
					if (result.error) {
						errors.push({ testName: testCase.metadata.name, error: result.error })
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`  💥 ERROR ${testCase.metadata.name}: ${errorMessage}`)
				errors.push({ testName: testCase.metadata.name, error: errorMessage })

				// Add failed result
				results.push({
					testCase,
					passed: false,
					executionTime: 0,
					metrics: this.createErrorMetrics(),
					error: errorMessage,
				})
			}
		}

		const totalTime = Date.now() - startTime
		const passedCount = results.filter((r) => r.passed).length
		const failedCount = results.length - passedCount

		// Calculate summary metrics
		const passRate = results.length > 0 ? (passedCount / results.length) * 100 : 0
		const totalExecutionTime = results.reduce((sum, r) => sum + r.executionTime, 0)
		const averageExecutionTime = results.length > 0 ? totalExecutionTime / results.length : 0
		const totalTokensUsed = results.reduce((sum, r) => sum + (r.metrics.tokensUsed || 0), 0)
		const averageSemanticSimilarity = 0 // Not implemented yet

		// Save results
		const summary: BenchmarkSummary = {
			totalTests: results.length,
			passedTests: passedCount,
			failedTests: failedCount,
			passRate,
			totalExecutionTime,
			averageExecutionTime,
			averageSemanticSimilarity,
			totalTokensUsed,
			results,
			errors,
		}

		// Save to storage
		const profileName = typeof options.profile === "string" ? options.profile : "unknown"
		this.resultStorage.saveRun(summary, profileName)

		return summary
	}

	/**
	 * Run all tests with given options (CLI interface)
	 */
	async runAllTests(options: BenchmarkOptions): Promise<BenchmarkSummary> {
		// Load test cases based on options
		const filter: { names?: string[]; categories?: string[] } = {}
		if (options.testCases) filter.names = options.testCases
		if (options.categories) filter.categories = options.categories

		const testCases = await this.loadTestCases(filter)
		return this.runTestCases(testCases, options)
	}

	/**
	 * Get available tests info (CLI interface)
	 */
	async getAvailableTests(): Promise<{
		testCases: Array<{ name: string; category: string; description: string }>
		categories: string[]
		statistics: any
	}> {
		const testCases = await this.testCaseLoader.loadAllTestCases()
		const categories = [...new Set(testCases.map((tc) => tc.metadata.category))]

		return {
			testCases: testCases.map((tc) => ({
				name: tc.metadata.name,
				category: tc.metadata.category,
				description: tc.metadata.description,
			})),
			categories,
			statistics: {
				totalTestCases: testCases.length,
				formatBreakdown: { newFormat: testCases.length, legacyFormat: 0 },
				cursorMarkerStats: { hasCursor: testCases.length, noCursor: 0 },
			},
		}
	}

	/**
	 * Load test cases by name or category
	 */
	async loadTestCases(filter?: { names?: string[]; categories?: string[] }): Promise<BenchmarkTestCase[]> {
		const allTestCases = await this.testCaseLoader.loadAllTestCases()

		let filteredCases = allTestCases

		if (filter?.names) {
			filteredCases = filteredCases.filter((tc) => filter.names!.includes(tc.metadata.name))
		}

		if (filter?.categories) {
			filteredCases = filteredCases.filter((tc) => filter.categories!.includes(tc.metadata.category))
		}

		return filteredCases
	}

	/**
	 * Get available test case names
	 */
	async getAvailableTestCases(): Promise<string[]> {
		const testCases = await this.testCaseLoader.loadAllTestCases()
		return testCases.map((tc) => tc.metadata.name)
	}

	/**
	 * Apply all suggestions from a GhostSuggestionFile to the original content
	 */
	private applyAllSuggestions(originalContent: string, suggestionFile: any): string {
		const lines = originalContent.split("\n")
		const operations = suggestionFile.getAllOperations()

		// Sort operations by line number in descending order to avoid index shifts
		const sortedOps = operations.sort((a: any, b: any) => b.line - a.line)

		for (const operation of sortedOps) {
			if (operation.type === "+") {
				// Insert line
				lines.splice(operation.line, 0, operation.content)
			} else if (operation.type === "-") {
				// Remove line
				if (operation.line < lines.length) {
					lines.splice(operation.line, 1)
				}
			}
		}

		return lines.join("\n")
	}

	/**
	 * Create error metrics for failed tests
	 */
	private createErrorMetrics(): BenchmarkMetrics {
		return {
			responseTime: 0,
			success: false,
			tokensUsed: 0,
		}
	}
}

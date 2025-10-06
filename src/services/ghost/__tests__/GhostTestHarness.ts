import { parseContentWithCursor } from "../strategies/mercury/__tests__/testUtils"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { MercuryStrategy } from "../strategies/MercuryStrategy"
import { FimStrategy } from "../strategies/FimStrategy"
import { HoleFillStrategy } from "../strategies/HoleFillStrategy"
import { LegacyXmlStrategy } from "../strategies/LegacyXmlStrategy"
import { StringGhostApplicator } from "../applicators/StringGhostApplicator"
import { PromptStrategy } from "../types/PromptStrategy"

/**
 * Test case interface
 */
export interface GhostTestCase {
	name: string
	inputFile: string // Content with cursor marker ␣
	mockResponse: string // What the LLM would return
	expectedOutput: string // Expected final file content
	strategy: "mercury-coder" | "fim" | "hole-filler" | "legacy-xml"
}

/**
 * Result from test execution
 */
export interface GhostTestResult {
	success: boolean
	finalContent: string
	actualOutput: string
	expectedOutput: string
	suggestions: GhostSuggestionsState | null
	error?: string
}

/**
 * Simple Ghost testing harness that uses direct strategy testing.
 * Updated to use StringGhostApplicator and centralized application logic.
 */
export class GhostTestHarness {
	/**
	 * Execute a Ghost test case with mock response
	 */
	static async execute(testCase: GhostTestCase): Promise<GhostTestResult> {
		try {
			// 1. Parse input
			const { document, cursorRange, cleanContent } = parseContentWithCursor(testCase.inputFile, "/test.js")

			// 2. Map strategy names to classes with proper typing
			const strategyMap: Record<string, new () => PromptStrategy> = {
				"mercury-coder": MercuryStrategy,
				fim: FimStrategy,
				"hole-filler": HoleFillStrategy,
				"legacy-xml": LegacyXmlStrategy,
			}

			const strategyClass = strategyMap[testCase.strategy]
			if (!strategyClass) {
				return {
					success: false,
					finalContent: "",
					actualOutput: "",
					expectedOutput: testCase.expectedOutput,
					suggestions: null,
					error: `Unknown strategy: ${testCase.strategy}`,
				}
			}

			// 3. Create strategy instance with proper typing
			const strategy: PromptStrategy = new strategyClass()

			// 4. Create context (same as existing tests)
			const context = {
				document,
				range: cursorRange,
				position: cursorRange.start,
				diagnostics: [],
			}

			// 5. Process using the unified streaming API for all strategies
			let finalContent = cleanContent

			// All strategies now use the streaming API
			strategy.initializeProcessing(context)
			strategy.processResponseChunk(testCase.mockResponse)
			const result = strategy.finishProcessing()

			// Apply suggestions using StringGhostApplicator
			if (result.hasNewSuggestions && result.suggestions) {
				const applicator = new StringGhostApplicator()
				applicator.setOriginalContent(document.uri.toString(), cleanContent)
				await applicator.applyAll(result.suggestions, document.uri.toString())
				const appliedContent = applicator.getResult(document.uri.toString())
				finalContent = appliedContent || cleanContent
			}

			console.log("=== GHOST TEST HARNESS DEBUG ===")
			console.log("Actual final content:", JSON.stringify(finalContent))
			console.log("Expected output:", JSON.stringify(testCase.expectedOutput))
			console.log("Content matches:", finalContent === testCase.expectedOutput)
			console.log("=== END DEBUG ===")

			return {
				success: finalContent === testCase.expectedOutput,
				finalContent,
				actualOutput: finalContent,
				expectedOutput: testCase.expectedOutput,
				suggestions: null,
			}
		} catch (error) {
			return {
				success: false,
				finalContent: "",
				actualOutput: "",
				expectedOutput: testCase.expectedOutput,
				suggestions: null,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}
}

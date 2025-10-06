import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "./GhostTestHarness"

/**
 * Debug test to understand why GhostTestHarness is returning empty results
 */
describe("GhostTestHarness Debug", () => {
	it("should debug Mercury strategy execution", async () => {
		const testCase: GhostTestCase = {
			name: "debug-mercury",
			inputFile: `function test() {
    ␣
}`,
			mockResponse: `<|code_to_edit|>
function test() {
    console.log('hello');
}
<|/code_to_edit|>`,
			expectedOutput: `function test() {
    console.log('hello');
}`,
			strategy: "mercury-coder",
		}

		console.log("🔍 Debug: Starting test execution")
		const result = await GhostTestHarness.execute(testCase)

		console.log("🔍 Debug: Test result:", {
			success: result.success,
			finalContent: JSON.stringify(result.finalContent),
			actualOutput: JSON.stringify(result.actualOutput),
			expectedOutput: JSON.stringify(result.expectedOutput),
			error: result.error,
			hasSuggestions: result.suggestions?.hasSuggestions(),
		})

		if (result.suggestions) {
			console.log("🔍 Debug: Suggestions details:", {
				files: result.suggestions.getFiles().length,
				primaryFile: result.suggestions.getPrimaryFile()?.getAllOperations().length || 0,
			})
		}

		// Don't assert for now, just debug
		expect(result).toBeDefined()
	})
})

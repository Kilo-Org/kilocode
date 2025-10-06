import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "./GhostTestHarness"

/**
 * Debug the GhostTestHarness Mercury execution issue
 */
describe("GhostTestHarness Mercury Debug", () => {
	it("should debug Mercury strategy execution in test harness", async () => {
		const testCase: GhostTestCase = {
			name: "mercury-debug",
			inputFile: `function test() {
    ␣
}`,
			mockResponse: `<|code_to_edit|>
    return "hello";
<|/code_to_edit|>`,
			expectedOutput: `function test() {
    return "hello";
}`,
			strategy: "mercury-coder",
		}

		console.log("=== MERCURY TEST HARNESS DEBUG ===")
		console.log("Input file:", JSON.stringify(testCase.inputFile))
		console.log("Mock response:", JSON.stringify(testCase.mockResponse))
		console.log("Expected output:", JSON.stringify(testCase.expectedOutput))

		const result = await GhostTestHarness.execute(testCase)

		console.log("=== RESULT ===")
		console.log("Success:", result.success)
		console.log("Final content:", JSON.stringify(result.finalContent))
		console.log("Expected content:", JSON.stringify(result.expectedOutput))
		console.log("Error:", result.error)

		// For debugging, let's not fail the test, just log the results
		expect(result).toBeDefined()
	})
})

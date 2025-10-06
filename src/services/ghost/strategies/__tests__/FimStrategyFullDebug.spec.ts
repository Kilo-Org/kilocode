import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

describe("FimStrategy Full Debug", () => {
	it("should debug full FIM strategy pipeline", async () => {
		const testCase: GhostTestCase = {
			name: "fim-function-completion",
			inputFile: `function calculateTotal(items) {
    ␣
    return total;
}`,
			mockResponse: `let total = 0;
    for (const item of items) {
        total += item.price;
    }`,
			expectedOutput: `function calculateTotal(items) {
    let total = 0;
    for (const item of items) {
        total += item.price;
    }
    return total;
}`,
			strategy: "fim",
		}

		console.log("=== FULL PIPELINE DEBUG ===")
		console.log("Input file:", JSON.stringify(testCase.inputFile))
		console.log("Expected output:", JSON.stringify(testCase.expectedOutput))
		console.log("Mock response:", JSON.stringify(testCase.mockResponse))

		const result = await GhostTestHarness.execute(testCase)

		console.log("=== RESULT ===")
		console.log("Success:", result.success)
		console.log("Final content:", JSON.stringify(result.finalContent))
		console.log("Expected content:", JSON.stringify(result.expectedOutput))
		console.log("Actual output:", JSON.stringify(result.actualOutput))

		if (result.error) {
			console.log("Error:", result.error)
		}

		// Show character-by-character comparison if they don't match
		if (result.finalContent !== result.expectedOutput) {
			console.log("=== CHARACTER COMPARISON ===")
			const final = result.finalContent
			const expected = result.expectedOutput
			const maxLen = Math.max(final.length, expected.length)

			for (let i = 0; i < maxLen; i++) {
				const finalChar = final[i] || "(end)"
				const expectedChar = expected[i] || "(end)"
				if (finalChar !== expectedChar) {
					console.log(
						`Diff at position ${i}: got '${finalChar}' (${finalChar.charCodeAt(0)}), expected '${expectedChar}' (${expectedChar.charCodeAt(0)})`,
					)
					break
				}
			}
		}
	})
})

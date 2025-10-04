import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

describe("HoleFillStrategy Full Debug", () => {
	it("should debug full HoleFill strategy pipeline", async () => {
		const testCase: GhostTestCase = {
			name: "hole-fill-function",
			inputFile: `function validateEmail(email) {
    ␣
}`,
			mockResponse: `<COMPLETION>
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
return emailRegex.test(email);
</COMPLETION>`,
			expectedOutput: `function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
return emailRegex.test(email);
}`,
			strategy: "hole-filler",
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
					// Show context around the difference
					const start = Math.max(0, i - 10)
					const end = Math.min(maxLen, i + 10)
					console.log(`Context: final="${final.slice(start, end)}", expected="${expected.slice(start, end)}"`)
					break
				}
			}
		}
	})
})

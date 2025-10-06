import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

describe("LegacyXmlStrategy Debug", () => {
	it("should debug conditional logic completion", async () => {
		const testCase: GhostTestCase = {
			name: "legacy-xml-conditional",
			inputFile: `function processOrder(order) {
    ␣
    return order;
}`,
			mockResponse: `<change>
<search><![CDATA[function processOrder(order) {
    
    return order;
}]]></search>
<replace><![CDATA[function processOrder(order) {
    if (!order.isValid) {
        throw new Error('Invalid order');
    }
    return order;
}]]></replace>
</change>`,
			expectedOutput: `function processOrder(order) {
    if (!order.isValid) {
        throw new Error('Invalid order');
    }
    return order;
}`,
			strategy: "legacy-xml",
		}

		console.log("=== LEGACY XML DEBUG ===")
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

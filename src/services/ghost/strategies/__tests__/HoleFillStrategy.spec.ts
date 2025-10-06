import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

/**
 * Hole Fill Strategy Tests
 * Tests the Hole Fill strategy with <COMPLETION> XML format
 */
describe("Hole Fill Strategy", () => {
	it("should complete function using COMPLETION tags", async () => {
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

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete loop implementation", async () => {
		const testCase: GhostTestCase = {
			name: "hole-fill-loop",
			inputFile: `function findMax(numbers) {
    let max = numbers[0];
    ␣
    return max;
}`,
			mockResponse: `<COMPLETION>
for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > max) {
        max = numbers[i];
    }
}
</COMPLETION>`,
			expectedOutput: `function findMax(numbers) {
    let max = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > max) {
        max = numbers[i];
    }
}
    return max;
}`,
			strategy: "hole-filler",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete object method", async () => {
		const testCase: GhostTestCase = {
			name: "hole-fill-object-method",
			inputFile: `const utils = {
    formatDate(date) {
        ␣
    }
};`,
			mockResponse: `<COMPLETION>
return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});
</COMPLETION>`,
			expectedOutput: `const utils = {
    formatDate(date) {
        return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});
    }
};`,
			strategy: "hole-filler",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})
})

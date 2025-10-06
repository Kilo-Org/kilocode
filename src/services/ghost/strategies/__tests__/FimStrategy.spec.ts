import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

/**
 * FIM Strategy Tests
 * Tests the Fill-in-Middle strategy with raw text responses
 */
describe("FIM Strategy", () => {
	it("should complete function body using FIM tokens", async () => {
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

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete variable assignment", async () => {
		const testCase: GhostTestCase = {
			name: "fim-variable-assignment",
			inputFile: `const config = {
    apiUrl: 'https://api.example.com',
    ␣
};`,
			mockResponse: `timeout: 5000,
    retries: 3`,
			expectedOutput: `const config = {
    apiUrl: 'https://api.example.com',
    timeout: 5000,
    retries: 3
};`,
			strategy: "fim",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete import statement", async () => {
		const testCase: GhostTestCase = {
			name: "fim-import-completion",
			inputFile: `import { ␣ } from 'react';

function MyComponent() {
    return <div>Hello</div>;
}`,
			mockResponse: `useState, useEffect`,
			expectedOutput: `import { useState, useEffect } from 'react';

function MyComponent() {
    return <div>Hello</div>;
}`,
			strategy: "fim",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})
})

import { describe, it, expect } from "vitest"
import { GhostTestHarness, GhostTestCase } from "../../__tests__/GhostTestHarness"

/**
 * Mercury Strategy Tests
 * Tests the Mercury Coder strategy with <|code_to_edit|> format
 */
describe("Mercury Strategy", () => {
	it("should complete function body with conditional logic", async () => {
		const testCase: GhostTestCase = {
			name: "mercury-conditional-completion",
			inputFile: `function checkUserAccess(user) {
    // Check if user is an adult
    ␣

    return false;
}`,
			mockResponse: `<|code_to_edit|>
function checkUserAccess(user) {
    // Check if user is an adult
    if (user.age >= 18) {
        return true;
    }

    return false;
}
<|/code_to_edit|>`,
			expectedOutput: `function checkUserAccess(user) {
    // Check if user is an adult
    if (user.age >= 18) {
        return true;
    }

    return false;
}`,
			strategy: "mercury-coder",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete async function with error handling", async () => {
		const testCase: GhostTestCase = {
			name: "mercury-async-completion",
			inputFile: `async function fetchUserData(id) {
    ␣
}`,
			mockResponse: `<|code_to_edit|>
async function fetchUserData(id) {
    try {
        const response = await fetch(\`/api/users/\${id}\`);
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch user:', error);
        throw error;
    }
}
<|/code_to_edit|>`,
			expectedOutput: `async function fetchUserData(id) {
    try {
        const response = await fetch(\`/api/users/\${id}\`);
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch user:', error);
        throw error;
    }
}`,
			strategy: "mercury-coder",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})

	it("should complete class method implementation", async () => {
		const testCase: GhostTestCase = {
			name: "mercury-class-method",
			inputFile: `class Calculator {
    ␣
}`,
			mockResponse: `<|code_to_edit|>
class Calculator {
    add(a, b) {
        return a + b;
    }
}
<|/code_to_edit|>`,
			expectedOutput: `class Calculator {
    add(a, b) {
        return a + b;
    }
}`,
			strategy: "mercury-coder",
		}

		const result = await GhostTestHarness.execute(testCase)
		expect(result.success).toBe(true)
		expect(result.finalContent).toBe(testCase.expectedOutput)
	})
})

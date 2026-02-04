// Mock ManagedIndexer before importing anything that uses it
vi.mock("../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: vi.fn().mockReturnValue({
			isEnabled: vi.fn().mockReturnValue(false),
			organization: null,
		}),
	},
}))

import { getToolUseGuidelinesSection } from "../tool-use-guidelines"

describe("getToolUseGuidelinesSection", () => {
	it("should include proper numbered guidelines", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("1. Assess what information")
		expect(guidelines).toContain("2. Choose the most appropriate tool")
		expect(guidelines).toContain("3. If multiple actions are needed")
	})

	it("should include multiple-tools-per-message guidance", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("you may use multiple tools in a single message")
		expect(guidelines).not.toContain("use one tool at a time per message")
	})

	it("should use simplified footer without step-by-step language", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("carefully considering the user's response after tool executions")
		expect(guidelines).not.toContain("It is crucial to proceed step-by-step")
		expect(guidelines).not.toContain("ALWAYS wait for user confirmation after each tool use")
	})

	it("should include common guidance", () => {
		const guidelines = getToolUseGuidelinesSection()
		expect(guidelines).toContain("Assess what information you already have")
		expect(guidelines).toContain("Choose the most appropriate tool")
		expect(guidelines).not.toContain("<actual_tool_name>")
	})

	it("should not include per-tool confirmation guidelines", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).not.toContain("After each tool use, the user will respond with the result")
	})
})

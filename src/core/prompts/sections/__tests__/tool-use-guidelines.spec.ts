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
import { TOOL_PROTOCOL } from "@roo-code/types"
import { EXPERIMENT_IDS } from "../../../../shared/experiments"

describe("getToolUseGuidelinesSection", () => {
	describe("XML protocol", () => {
		it("should include proper numbered guidelines", () => {
			const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.XML)

			// Check that all numbered items are present with correct numbering
			expect(guidelines).toContain("1. Assess what information")
			expect(guidelines).toContain("2. Choose the most appropriate tool")
			expect(guidelines).toContain("3. If multiple actions are needed")
			expect(guidelines).toContain("4. Formulate your tool use")
			expect(guidelines).toContain("5. After each tool use")
			expect(guidelines).toContain("6. ALWAYS wait for user confirmation")
		})

		it("should include XML-specific guidelines", () => {
			const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.XML)

			expect(guidelines).toContain("Formulate your tool use using the XML format specified for each tool")
			expect(guidelines).toContain("use one tool at a time per message")
			expect(guidelines).toContain("ALWAYS wait for user confirmation")
		})

		it("should include iterative process guidelines", () => {
			const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.XML)

			expect(guidelines).toContain("It is crucial to proceed step-by-step")
			expect(guidelines).toContain("1. Confirm the success of each step before proceeding")
			expect(guidelines).toContain("2. Address any issues or errors that arise immediately")
			expect(guidelines).toContain("3. Adapt your approach based on new information")
			expect(guidelines).toContain("4. Ensure that each action builds correctly")
		})
	})

	describe("native protocol", () => {
		describe("with MULTIPLE_NATIVE_TOOL_CALLS disabled (default)", () => {
			it("should include proper numbered guidelines", () => {
				const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE)

				// Check that all numbered items are present with correct numbering
				expect(guidelines).toContain("1. Assess what information")
				expect(guidelines).toContain("2. Choose the most appropriate tool")
				expect(guidelines).toContain("3. If multiple actions are needed")
				expect(guidelines).toContain("5. After each tool use")
			})
			it("should include single-tool-per-message guidance when experiment disabled", () => {
				const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE, {})

				expect(guidelines).toContain("use one tool at a time per message")
				expect(guidelines).not.toContain("you may use multiple tools in a single message")
				expect(guidelines).not.toContain("Formulate your tool use using the XML format")
				expect(guidelines).not.toContain("ALWAYS wait for user confirmation")
			})

			it("should include simplified iterative process guidelines", () => {
				const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE)

				expect(guidelines).toContain("carefully considering the user's response after tool executions")
				// Native protocol doesn't have the step-by-step list
				expect(guidelines).not.toContain("It is crucial to proceed step-by-step")
			})
		})

		describe("with MULTIPLE_NATIVE_TOOL_CALLS enabled", () => {
			it("should include multiple-tools-per-message guidance when experiment enabled", () => {
				const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE, {
					[EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS]: true,
				})

				expect(guidelines).toContain("you may use multiple tools in a single message")
				expect(guidelines).not.toContain("use one tool at a time per message")
			})

			it("should include simplified iterative process guidelines", () => {
				const guidelines = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE, {
					[EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS]: true,
				})

				expect(guidelines).toContain("carefully considering the user's response after tool executions")
				expect(guidelines).not.toContain("It is crucial to proceed step-by-step")
			})
		})
	})

	it("should include common guidance regardless of protocol", () => {
		const guidelinesXml = getToolUseGuidelinesSection(TOOL_PROTOCOL.XML)
		const guidelinesNative = getToolUseGuidelinesSection(TOOL_PROTOCOL.NATIVE)

		for (const guidelines of [guidelinesXml, guidelinesNative]) {
			expect(guidelines).toContain("Assess what information you already have")
			expect(guidelines).toContain("Choose the most appropriate tool")
			expect(guidelines).toContain("After each tool use, the user will respond")
		}
	})
})

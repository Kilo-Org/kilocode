import { describe, expect, it, vi } from "vitest"
import { AutoTriggerStrategyTester } from "./auto-trigger-strategy.js"
import { CURSOR_MARKER } from "../services/ghost/ghostConstants.js"

// Mock LLMClient to avoid needing API keys in tests
vi.mock("./llm-client.js", () => ({
	LLMClient: class MockLLMClient {
		constructor() {}
		async sendPrompt() {
			return { content: "" }
		}
	},
}))

describe("AutoTriggerStrategyTester", () => {
	// Helper to extract code block from prompt
	const extractCodeBlock = (prompt: string): string => {
		const match = prompt.match(/```[^\n]*\n([\s\S]*?)\n```/)
		return match ? match[1] : ""
	}

	describe("createContext", () => {
		it("should not duplicate cursor marker in document", async () => {
			// Dynamically import to use the mocked version
			const { LLMClient } = await import("./llm-client.js")
			const llmClient = new LLMClient()
			const tester = new AutoTriggerStrategyTester(llmClient)

			const input = `function test() {\n         console.log('hello')${CURSOR_MARKER}}`
			const userPrompt = tester.buildUserPrompt(input)

			// Extract the code block and count markers there
			const codeBlock = extractCodeBlock(userPrompt)
			const markerCount = (
				codeBlock.match(new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []
			).length

			// Should appear exactly once in the code block
			expect(markerCount).toBe(1)
		})

		it("should preserve cursor position when marker is removed and re-added", async () => {
			const { LLMClient } = await import("./llm-client.js")
			const llmClient = new LLMClient()
			const tester = new AutoTriggerStrategyTester(llmClient)

			const input = `const x = 42${CURSOR_MARKER}`
			const userPrompt = tester.buildUserPrompt(input)

			// Extract the code block
			const codeBlock = extractCodeBlock(userPrompt)

			// The code block should contain the cursor marker at the correct position
			expect(codeBlock).toContain(`const x = 42${CURSOR_MARKER}`)

			// Count occurrences to ensure no duplication in code block
			const markerCount = (
				codeBlock.match(new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []
			).length
			expect(markerCount).toBe(1)
		})

		it("should handle cursor marker in middle of line", async () => {
			const { LLMClient } = await import("./llm-client.js")
			const llmClient = new LLMClient()
			const tester = new AutoTriggerStrategyTester(llmClient)

			const input = `const x = ${CURSOR_MARKER}42`
			const userPrompt = tester.buildUserPrompt(input)

			// Extract the code block and verify marker appears exactly once
			const codeBlock = extractCodeBlock(userPrompt)
			const markerCount = (
				codeBlock.match(new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []
			).length
			expect(markerCount).toBe(1)
		})

		it("should handle multiline code with cursor marker", async () => {
			const { LLMClient } = await import("./llm-client.js")
			const llmClient = new LLMClient()
			const tester = new AutoTriggerStrategyTester(llmClient)

			const input = `function test() {\n  console.log('hello')${CURSOR_MARKER}\n}`
			const userPrompt = tester.buildUserPrompt(input)

			// Extract the code block and verify marker appears exactly once
			const codeBlock = extractCodeBlock(userPrompt)
			const markerCount = (
				codeBlock.match(new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []
			).length
			expect(markerCount).toBe(1)
		})
	})
})

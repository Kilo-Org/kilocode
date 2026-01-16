import { getSharedToolUseSection } from "../tool-use"
import { TOOL_PROTOCOL } from "@roo-code/types"

describe("getSharedToolUseSection", () => {
	describe("XML protocol", () => {
		it("should include one tool per message requirement", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.XML)

			expect(section).toContain("You must use exactly one tool per message")
			expect(section).toContain("every assistant message must include a tool call")
		})

		it("should include XML formatting instructions", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.XML)

			expect(section).toContain("XML-style tags")
			expect(section).toContain("Always use the actual tool name as the XML tag name")
		})
	})

	describe("native protocol", () => {
		it("should include one tool per message requirement when experiment is disabled", () => {
			// No experiment flags passed (default: disabled)
			const section = getSharedToolUseSection(TOOL_PROTOCOL.NATIVE)

			expect(section).toContain("You must use exactly one tool call per assistant response")
			expect(section).toContain("Do not call zero tools or more than one tool")
		})

		it("should include one tool per message requirement when experiment is explicitly disabled", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.NATIVE, { multipleNativeToolCalls: false })

			expect(section).toContain("You must use exactly one tool call per assistant response")
			expect(section).toContain("Do not call zero tools or more than one tool")
		})

		it("should NOT include one tool per message requirement when experiment is enabled", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.NATIVE, { multipleNativeToolCalls: true })

			expect(section).not.toContain("You must use exactly one tool per message")
			expect(section).not.toContain("every assistant message must include a tool call")
			expect(section).toContain("You must call at least one tool per assistant response")
			expect(section).toContain("Prefer calling as many tools as are reasonably needed")
		})

		it("should include native tool-calling instructions", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.NATIVE)

			expect(section).toContain("provider-native tool-calling mechanism")
			expect(section).toContain("Do not include XML markup or examples")
		})

		it("should NOT include XML formatting instructions", () => {
			const section = getSharedToolUseSection(TOOL_PROTOCOL.NATIVE)

			expect(section).not.toContain("XML-style tags")
			expect(section).not.toContain("Always use the actual tool name as the XML tag name")
		})
	})

	describe("default protocol", () => {
		it("should default to XML protocol when no protocol is specified", () => {
			const section = getSharedToolUseSection()

			expect(section).toContain("XML-style tags")
			expect(section).toContain("You must use exactly one tool per message")
		})
	})
})

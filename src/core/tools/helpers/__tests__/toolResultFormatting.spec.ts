import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as vscode from "vscode"
import { TOOL_PROTOCOL, isNativeProtocol } from "@roo-code/types"
import { formatToolInvocation, getCurrentToolProtocol } from "../toolResultFormatting"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

describe("toolResultFormatting", () => {
	let mockGetConfiguration: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockGetConfiguration = vi.fn()
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: mockGetConfiguration,
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getCurrentToolProtocol", () => {
		it("should return configured protocol", () => {
			mockGetConfiguration.mockReturnValue(TOOL_PROTOCOL.NATIVE)
			expect(getCurrentToolProtocol()).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should default to xml when config is not set", () => {
			mockGetConfiguration.mockReturnValue("xml")
			expect(getCurrentToolProtocol()).toBe("xml")
		})
	})

	describe("isNativeProtocol", () => {
		it("should return true for native protocol", () => {
			expect(isNativeProtocol(TOOL_PROTOCOL.NATIVE)).toBe(true)
		})

		it("should return false for XML protocol", () => {
			expect(isNativeProtocol("xml")).toBe(false)
		})
	})

	describe("formatToolInvocation", () => {
		it("should format for XML protocol", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts" }, "xml")

			expect(result).toContain("<read_file>")
			expect(result).toContain("<path>")
			expect(result).toContain("test.ts")
			expect(result).toContain("</path>")
			expect(result).toContain("</read_file>")
		})

		it("should format for native protocol", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts" }, TOOL_PROTOCOL.NATIVE)

			expect(result).toBe("Called read_file with path: test.ts")
			expect(result).not.toContain("<")
		})

		it("should handle multiple parameters for XML", () => {
			const result = formatToolInvocation(
				"read_file",
				{ path: "test.ts", start_line: "1", end_line: "10" },
				"xml",
			)

			expect(result).toContain("<path>\ntest.ts\n</path>")
			expect(result).toContain("<start_line>\n1\n</start_line>")
			expect(result).toContain("<end_line>\n10\n</end_line>")
		})

		it("should handle multiple parameters for native", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts", start_line: "1" }, TOOL_PROTOCOL.NATIVE)

			expect(result).toContain("Called read_file with")
			expect(result).toContain("path: test.ts")
			expect(result).toContain("start_line: 1")
		})

		it("should handle empty parameters", () => {
			const result = formatToolInvocation("list_files", {}, TOOL_PROTOCOL.NATIVE)
			expect(result).toBe("Called list_files")
		})

		it("should use config when protocol not specified", () => {
			mockGetConfiguration.mockReturnValue(TOOL_PROTOCOL.NATIVE)
			const result = formatToolInvocation("read_file", { path: "test.ts" })
			expect(result).toBe("Called read_file with path: test.ts")
		})
	})
})

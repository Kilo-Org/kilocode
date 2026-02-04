import { describe, it, expect } from "vitest"
import { formatToolInvocation } from "../toolResultFormatting"

describe("toolResultFormatting", () => {
	describe("formatToolInvocation", () => {
		it("should format", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts" })

			expect(result).toBe("Called read_file with path: test.ts")
			expect(result).not.toContain("<")
		})

		it("should handle multiple parameters", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts", start_line: "1" })

			expect(result).toContain("Called read_file with")
			expect(result).toContain("path: test.ts")
			expect(result).toContain("start_line: 1")
		})

		it("should handle empty parameters", () => {
			const result = formatToolInvocation("list_files", {})
			expect(result).toBe("Called list_files")
		})
	})
})

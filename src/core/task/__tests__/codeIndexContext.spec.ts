import { describe, it, expect } from "vitest"

import { extractLatestUserQuery, formatCodeIndexContext } from "../kilocode/codeIndexContext"

describe("codeIndexContext", () => {
	it("extractLatestUserQuery returns last user message text", () => {
		const messages: any[] = [
			{ role: "assistant", content: "a" },
			{ role: "user", content: "first" },
			{ role: "assistant", content: "b" },
			{ role: "user", content: [{ type: "text", text: "second" }] },
		]
		expect(extractLatestUserQuery(messages as any)).toBe("second")
	})

	it("formatCodeIndexContext returns empty string when no results", () => {
		expect(formatCodeIndexContext([])).toBe("")
	})

	it("formatCodeIndexContext formats and truncates", () => {
		const results: any[] = [
			{
				id: "1",
				score: 0.9,
				payload: { filePath: "src/a.ts", startLine: 1, endLine: 2, codeChunk: "hello" },
			},
		]
		const out = formatCodeIndexContext(results as any, { maxChars: 20 })
		expect(out.length).toBeLessThanOrEqual(20)
	})
})

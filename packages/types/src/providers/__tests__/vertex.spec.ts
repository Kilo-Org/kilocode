// kilocode_change - new file
import { normalizeVertexModelId } from "../vertex.js"

describe("normalizeVertexModelId", () => {
	test("returns canonical id when already valid", () => {
		expect(normalizeVertexModelId("claude-opus-4-6")).toBe("claude-opus-4-6")
	})

	test("normalizes legacy claude-opus-4-6 aliases", () => {
		expect(normalizeVertexModelId("claude-opus-4-6@default")).toBe("claude-opus-4-6")
		expect(normalizeVertexModelId("claude-opus-4-6@vertex")).toBe("claude-opus-4-6")
	})

	test("falls back to vertex default for unknown ids", () => {
		expect(normalizeVertexModelId("unknown-model")).toBe("claude-sonnet-4-5@20250929")
	})
})

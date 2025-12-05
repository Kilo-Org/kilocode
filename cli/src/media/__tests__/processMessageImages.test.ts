import { removeImageReferences } from "../processMessageImages"

describe("processMessageImages helpers", () => {
	describe("removeImageReferences", () => {
		it("should remove image reference tokens without collapsing whitespace", () => {
			const input = "Line1\n  [Image #1]\nLine3"
			const result = removeImageReferences(input)

			expect(result).toBe("Line1\n  \nLine3")
		})
	})
})

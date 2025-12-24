import {
	parseAtMentions,
	extractImagePaths,
	removeImageMentions,
	reconstructText,
	type ParsedSegment,
} from "../atMentionParser"

describe("atMentionParser", () => {
	describe("parseAtMentions", () => {
		it("should parse simple @ mentions", () => {
			const result = parseAtMentions("Check @./image.png please")

			expect(result.paths).toEqual(["./image.png"])
			expect(result.imagePaths).toEqual(["./image.png"])
			expect(result.otherPaths).toEqual([])
			expect(result.segments).toHaveLength(3)
		})

		it("should parse multiple @ mentions", () => {
			const result = parseAtMentions("Look at @./first.png and @./second.jpg")

			expect(result.paths).toEqual(["./first.png", "./second.jpg"])
			expect(result.imagePaths).toEqual(["./first.png", "./second.jpg"])
		})

		it("should distinguish image and non-image paths", () => {
			const result = parseAtMentions("Check @./code.ts and @./screenshot.png")

			expect(result.paths).toEqual(["./code.ts", "./screenshot.png"])
			expect(result.imagePaths).toEqual(["./screenshot.png"])
			expect(result.otherPaths).toEqual(["./code.ts"])
		})

		it("should handle quoted paths with spaces", () => {
			const result = parseAtMentions('Look at @"path with spaces/image.png"')

			expect(result.paths).toEqual(["path with spaces/image.png"])
			expect(result.imagePaths).toEqual(["path with spaces/image.png"])
		})

		it("should handle single-quoted paths", () => {
			const result = parseAtMentions("Look at @'path with spaces/image.png'")

			expect(result.paths).toEqual(["path with spaces/image.png"])
		})

		it("should handle escaped spaces in paths", () => {
			const result = parseAtMentions("Look at @path\\ with\\ spaces/image.png")

			expect(result.paths).toEqual(["path with spaces/image.png"])
		})

		it("should stop at path terminators", () => {
			const result = parseAtMentions("Check @./image.png, then @./other.jpg")

			expect(result.paths).toEqual(["./image.png", "./other.jpg"])
		})

		it("should handle @ at end of string", () => {
			const result = parseAtMentions("End with @")

			expect(result.paths).toEqual([])
			expect(result.segments).toHaveLength(1)
		})

		it("should handle text without @ mentions", () => {
			const result = parseAtMentions("Just regular text without mentions")

			expect(result.paths).toEqual([])
			expect(result.segments).toHaveLength(1)
			expect(result.segments[0]).toMatchObject({
				type: "text",
				content: "Just regular text without mentions",
			})
		})

		it("should handle absolute paths", () => {
			const result = parseAtMentions("Check @/absolute/path/image.png")

			expect(result.paths).toEqual(["/absolute/path/image.png"])
		})

		it("should handle relative paths with parent directory", () => {
			const result = parseAtMentions("Check @../parent/image.png")

			expect(result.paths).toEqual(["../parent/image.png"])
		})

		it("should preserve segment positions", () => {
			const input = "Start @./image.png end"
			const result = parseAtMentions(input)

			expect(result.segments[0]).toMatchObject({
				type: "text",
				content: "Start ",
				startIndex: 0,
				endIndex: 6,
			})
			expect(result.segments[1]).toMatchObject({
				type: "atPath",
				content: "./image.png",
				startIndex: 6,
				endIndex: 18,
			})
			expect(result.segments[2]).toMatchObject({
				type: "text",
				content: " end",
				startIndex: 18,
				endIndex: 22,
			})
		})

		it("should handle @ in email addresses (not a file path)", () => {
			// @ followed by typical email pattern should be parsed but not as an image
			const result = parseAtMentions("Email: test@example.com")

			// It will try to parse but example.com is not an image
			expect(result.imagePaths).toEqual([])
		})

		it("should handle multiple @ mentions consecutively", () => {
			const result = parseAtMentions("@./a.png@./b.png")

			// Without whitespace separator, @ is part of the path
			// This is expected behavior - paths need whitespace separation
			expect(result.paths).toHaveLength(1)
			expect(result.paths[0]).toBe("./a.png@./b.png")
		})

		it("should ignore trailing punctuation when parsing image paths", () => {
			const result = parseAtMentions("Check @./image.png? please and @./second.jpg.")

			expect(result.imagePaths).toEqual(["./image.png", "./second.jpg"])
			expect(result.otherPaths).toEqual([])
		})
	})

	describe("extractImagePaths", () => {
		it("should extract only image paths", () => {
			const paths = extractImagePaths("Check @./code.ts and @./image.png and @./doc.md")

			expect(paths).toEqual(["./image.png"])
		})

		it("should return empty array for text without images", () => {
			const paths = extractImagePaths("No images here, just @./file.ts")

			expect(paths).toEqual([])
		})

		it("should handle all supported image formats", () => {
			const paths = extractImagePaths("@./a.png @./b.jpg @./c.jpeg @./d.webp")

			expect(paths).toEqual(["./a.png", "./b.jpg", "./c.jpeg", "./d.webp"])
		})
	})

	describe("removeImageMentions", () => {
		it("should remove image mentions from text", () => {
			const result = removeImageMentions("Check @./image.png please")

			expect(result).toBe("Check  please")
		})

		it("should preserve non-image mentions", () => {
			const result = removeImageMentions("Check @./code.ts and @./image.png")

			expect(result).toBe("Check @./code.ts and ")
		})

		it("should use custom placeholder", () => {
			const result = removeImageMentions("Check @./image.png please", "[image]")

			expect(result).toBe("Check [image] please")
		})

		it("should handle multiple image mentions", () => {
			const result = removeImageMentions("@./a.png and @./b.jpg here")

			expect(result).toBe(" and  here")
		})

		it("should not collapse newlines or indentation", () => {
			const input = "Line1\n  @./img.png\nLine3"
			const result = removeImageMentions(input)

			expect(result).toBe("Line1\n  \nLine3")
		})
	})

	describe("reconstructText", () => {
		it("should reconstruct text from segments", () => {
			const segments: ParsedSegment[] = [
				{ type: "text", content: "Hello ", startIndex: 0, endIndex: 6 },
				{ type: "atPath", content: "./image.png", startIndex: 6, endIndex: 18 },
				{ type: "text", content: " world", startIndex: 18, endIndex: 24 },
			]

			const result = reconstructText(segments)

			expect(result).toBe("Hello @./image.png world")
		})

		it("should apply transform function", () => {
			const segments: ParsedSegment[] = [
				{ type: "text", content: "Check ", startIndex: 0, endIndex: 6 },
				{ type: "atPath", content: "./image.png", startIndex: 6, endIndex: 18 },
			]

			const result = reconstructText(segments, (seg) => {
				if (seg.type === "atPath") {
					return `[IMG: ${seg.content}]`
				}
				return seg.content
			})

			expect(result).toBe("Check [IMG: ./image.png]")
		})
	})

	describe("edge cases", () => {
		it("should handle empty string", () => {
			const result = parseAtMentions("")

			expect(result.paths).toEqual([])
			expect(result.segments).toHaveLength(0)
		})

		it("should handle only @", () => {
			const result = parseAtMentions("@")

			expect(result.paths).toEqual([])
		})

		it("should handle @ followed by space", () => {
			const result = parseAtMentions("@ space")

			expect(result.paths).toEqual([])
		})

		it("should handle unclosed quotes", () => {
			const result = parseAtMentions('Check @"unclosed quote')

			// Should still extract what it can
			expect(result.paths).toHaveLength(1)
		})

		it("should handle escaped backslash in path", () => {
			const result = parseAtMentions("@path\\\\with\\\\backslash.png")

			expect(result.paths).toEqual(["path\\with\\backslash.png"])
		})

		it("should handle various path terminators", () => {
			const tests = [
				{ input: "@./img.png)", expected: "./img.png" },
				{ input: "@./img.png]", expected: "./img.png" },
				{ input: "@./img.png}", expected: "./img.png" },
				{ input: "@./img.png>", expected: "./img.png" },
				{ input: "@./img.png|", expected: "./img.png" },
				{ input: "@./img.png&", expected: "./img.png" },
			]

			for (const { input, expected } of tests) {
				const result = parseAtMentions(input)
				expect(result.paths).toEqual([expected])
			}
		})
	})
})

// kilocode_change - new file
import { describe, expect, it } from "vitest"
import { parseDataUrlToImageBlock, parseDataUrlsToImageBlocks } from "../image-parsing"

describe("parseDataUrlToImageBlock", () => {
	it("should parse a valid PNG data URL", () => {
		const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
		const result = parseDataUrlToImageBlock(dataUrl)

		expect(result).toEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/png",
				data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
			},
		})
	})

	it("should parse a valid JPEG data URL", () => {
		const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
		const result = parseDataUrlToImageBlock(dataUrl)

		expect(result).toEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/jpeg",
				data: "/9j/4AAQSkZJRg==",
			},
		})
	})

	it("should parse a valid WebP data URL", () => {
		const dataUrl = "data:image/webp;base64,UklGRlYAAABXRUJQ"
		const result = parseDataUrlToImageBlock(dataUrl)

		expect(result).toEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/webp",
				data: "UklGRlYAAABXRUJQ",
			},
		})
	})

	it("should return null for empty string", () => {
		expect(parseDataUrlToImageBlock("")).toBeNull()
	})

	it("should return null for null input", () => {
		expect(parseDataUrlToImageBlock(null as unknown as string)).toBeNull()
	})

	it("should return null for undefined input", () => {
		expect(parseDataUrlToImageBlock(undefined as unknown as string)).toBeNull()
	})

	it("should return null for non-string input", () => {
		expect(parseDataUrlToImageBlock(123 as unknown as string)).toBeNull()
	})

	it("should return null for data URL without comma", () => {
		expect(parseDataUrlToImageBlock("data:image/pngbase64")).toBeNull()
	})

	it("should return null for data URL without mime type", () => {
		expect(parseDataUrlToImageBlock("data:;base64,iVBORw0KGgo")).toBeNull()
	})

	it("should return null for data URL without base64 data", () => {
		expect(parseDataUrlToImageBlock("data:image/png;base64,")).toBeNull()
	})

	it("should handle data URLs with special characters in base64", () => {
		const dataUrl = "data:image/png;base64,abc+def/ghi="
		const result = parseDataUrlToImageBlock(dataUrl)

		expect(result).toEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/png",
				data: "abc+def/ghi=",
			},
		})
	})
})

describe("parseDataUrlsToImageBlocks", () => {
	it("should parse multiple valid data URLs", () => {
		const dataUrls = ["data:image/png;base64,iVBORw0KGgo", "data:image/jpeg;base64,/9j/4AAQ"]
		const result = parseDataUrlsToImageBlocks(dataUrls)

		expect(result).toHaveLength(2)
		expect(result[0].source).toEqual({
			type: "base64",
			media_type: "image/png",
			data: "iVBORw0KGgo",
		})
		expect(result[1].source).toEqual({
			type: "base64",
			media_type: "image/jpeg",
			data: "/9j/4AAQ",
		})
	})

	it("should filter out invalid data URLs", () => {
		const dataUrls = ["data:image/png;base64,validBase64", "invalid-url", "data:image/jpeg;base64,anotherValid"]
		const result = parseDataUrlsToImageBlocks(dataUrls)

		expect(result).toHaveLength(2)
	})

	it("should return empty array for undefined input", () => {
		expect(parseDataUrlsToImageBlocks(undefined)).toEqual([])
	})

	it("should return empty array for empty array", () => {
		expect(parseDataUrlsToImageBlocks([])).toEqual([])
	})

	it("should return empty array when all URLs are invalid", () => {
		const dataUrls = ["invalid1", "invalid2", ""]
		expect(parseDataUrlsToImageBlocks(dataUrls)).toEqual([])
	})
})

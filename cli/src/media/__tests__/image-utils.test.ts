/**
 * Tests for image-utils module
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { isDataUrl, convertImagesToDataUrls } from "../image-utils.js"

// Mock the processImagePaths function
vi.mock("../images.js", () => ({
	processImagePaths: vi.fn().mockImplementation(async (paths: string[]) => ({
		images: paths.map((p) => `data:image/png;base64,mock-${p.replace(/[^a-zA-Z0-9]/g, "")}`),
		errors: [],
	})),
}))

// Mock the logs service
vi.mock("../../services/logs.js", () => ({
	logs: {
		error: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("isDataUrl", () => {
	it("should return true for valid data URLs", () => {
		expect(isDataUrl("data:image/png;base64,abc123")).toBe(true)
		expect(isDataUrl("data:image/jpeg;base64,xyz")).toBe(true)
		expect(isDataUrl("data:text/plain;base64,hello")).toBe(true)
	})

	it("should return false for file paths", () => {
		expect(isDataUrl("/tmp/image.png")).toBe(false)
		expect(isDataUrl("./screenshot.png")).toBe(false)
		expect(isDataUrl("C:\\Users\\image.png")).toBe(false)
	})

	it("should return false for URLs that are not data URLs", () => {
		expect(isDataUrl("https://example.com/image.png")).toBe(false)
		expect(isDataUrl("file:///tmp/image.png")).toBe(false)
	})
})

describe("convertImagesToDataUrls", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should return empty result for undefined input", async () => {
		const result = await convertImagesToDataUrls(undefined)
		expect(result).toEqual({ images: [], errors: [] })
	})

	it("should return empty result for empty array", async () => {
		const result = await convertImagesToDataUrls([])
		expect(result).toEqual({ images: [], errors: [] })
	})

	it("should pass through data URLs unchanged", async () => {
		const dataUrl =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
		const result = await convertImagesToDataUrls([dataUrl])
		expect(result.images).toEqual([dataUrl])
		expect(result.errors).toEqual([])
	})

	it("should convert file paths to data URLs", async () => {
		const result = await convertImagesToDataUrls(["/tmp/image.png"])
		expect(result.images).toEqual(["data:image/png;base64,mock-tmpimagepng"])
		expect(result.errors).toEqual([])
	})

	it("should handle mixed data URLs and file paths", async () => {
		const dataUrl = "data:image/png;base64,existing"
		const result = await convertImagesToDataUrls([dataUrl, "/tmp/new.png"])
		expect(result.images).toEqual([dataUrl, "data:image/png;base64,mock-tmpnewpng"])
		expect(result.errors).toEqual([])
	})

	it("should handle multiple file paths", async () => {
		const result = await convertImagesToDataUrls(["/tmp/a.png", "/tmp/b.png"])
		expect(result.images).toEqual(["data:image/png;base64,mock-tmpapng", "data:image/png;base64,mock-tmpbpng"])
		expect(result.errors).toEqual([])
	})
})

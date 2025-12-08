import { removeImageReferences, extractImageReferences, processMessageImages } from "../processMessageImages"
import * as images from "../images"

// Mock the images module
vi.mock("../images", () => ({
	readImageAsDataUrl: vi.fn(),
}))

// Mock the logs module
vi.mock("../../services/logs", () => ({
	logs: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("processMessageImages helpers", () => {
	describe("removeImageReferences", () => {
		it("should remove image reference tokens without collapsing whitespace", () => {
			const input = "Line1\n  [Image #1]\nLine3"
			const result = removeImageReferences(input)

			expect(result).toBe("Line1\n  \nLine3")
		})

		it("should remove multiple image references", () => {
			const input = "Hello [Image #1] world [Image #2] test"
			const result = removeImageReferences(input)

			expect(result).toBe("Hello  world  test")
		})

		it("should handle text with no image references", () => {
			const input = "Hello world"
			const result = removeImageReferences(input)

			expect(result).toBe("Hello world")
		})
	})

	describe("extractImageReferences", () => {
		it("should extract single image reference number", () => {
			const input = "Hello [Image #1] world"
			const result = extractImageReferences(input)

			expect(result).toEqual([1])
		})

		it("should extract multiple image reference numbers", () => {
			const input = "Hello [Image #1] world [Image #3] test [Image #2]"
			const result = extractImageReferences(input)

			expect(result).toEqual([1, 3, 2])
		})

		it("should return empty array when no references", () => {
			const input = "Hello world"
			const result = extractImageReferences(input)

			expect(result).toEqual([])
		})

		it("should handle large reference numbers", () => {
			const input = "[Image #999]"
			const result = extractImageReferences(input)

			expect(result).toEqual([999])
		})
	})

	describe("processMessageImages", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should return original text when no images", async () => {
			const result = await processMessageImages("Hello world")

			expect(result).toEqual({
				text: "Hello world",
				images: [],
				hasImages: false,
				errors: [],
			})
		})

		it("should load images from [Image #N] references", async () => {
			const mockDataUrl = "data:image/png;base64,abc123"
			vi.mocked(images.readImageAsDataUrl).mockResolvedValue(mockDataUrl)

			const imageReferences = { 1: "/tmp/test.png" }
			const result = await processMessageImages("Hello [Image #1] world", imageReferences)

			expect(images.readImageAsDataUrl).toHaveBeenCalledWith("/tmp/test.png")
			expect(result.images).toEqual([mockDataUrl])
			expect(result.text).toBe("Hello  world")
			expect(result.hasImages).toBe(true)
			expect(result.errors).toEqual([])
		})

		it("should report error when image reference not found", async () => {
			const imageReferences = { 2: "/tmp/other.png" }
			const result = await processMessageImages("Hello [Image #1] world", imageReferences)

			expect(result.errors).toContain("Image #1 not found")
			expect(result.images).toEqual([])
		})

		it("should report error when image file fails to load", async () => {
			vi.mocked(images.readImageAsDataUrl).mockRejectedValue(new Error("File not found"))

			const imageReferences = { 1: "/tmp/missing.png" }
			const result = await processMessageImages("Hello [Image #1] world", imageReferences)

			expect(result.errors).toContain("Failed to load Image #1: File not found")
			expect(result.images).toEqual([])
		})

		it("should handle multiple image references", async () => {
			const mockDataUrl1 = "data:image/png;base64,img1"
			const mockDataUrl2 = "data:image/png;base64,img2"
			vi.mocked(images.readImageAsDataUrl).mockResolvedValueOnce(mockDataUrl1).mockResolvedValueOnce(mockDataUrl2)

			const imageReferences = {
				1: "/tmp/test1.png",
				2: "/tmp/test2.png",
			}
			const result = await processMessageImages("[Image #1] and [Image #2]", imageReferences)

			expect(result.images).toEqual([mockDataUrl1, mockDataUrl2])
			expect(result.text).toBe(" and ")
			expect(result.hasImages).toBe(true)
		})

		it("should process without imageReferences parameter", async () => {
			const result = await processMessageImages("Hello world")

			expect(result.text).toBe("Hello world")
			expect(result.images).toEqual([])
			expect(result.hasImages).toBe(false)
		})
	})
})

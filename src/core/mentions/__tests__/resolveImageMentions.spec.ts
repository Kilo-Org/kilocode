import * as path from "path"

import { resolveImageMentions } from "../resolveImageMentions"

vi.mock("../../tools/helpers/imageHelpers", () => ({
	isSupportedImageFormat: vi.fn((ext: string) =>
		[".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".tif", ".avif"].includes(
			ext.toLowerCase(),
		),
	),
	readImageAsDataUrlWithBuffer: vi.fn(),
	validateImageForProcessing: vi.fn(),
	ImageMemoryTracker: vi.fn().mockImplementation(() => ({
		getTotalMemoryUsed: vi.fn().mockReturnValue(0),
		addMemoryUsage: vi.fn(),
	})),
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB: 5,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB: 20,
}))

import { validateImageForProcessing, readImageAsDataUrlWithBuffer } from "../../tools/helpers/imageHelpers"

const mockReadImageAsDataUrl = vi.mocked(readImageAsDataUrlWithBuffer)
const mockValidateImage = vi.mocked(validateImageForProcessing)

describe("resolveImageMentions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Default: validation passes
		mockValidateImage.mockResolvedValue({ isValid: true, sizeInMB: 0.1 })
	})

	it("should append a data URL when a local png mention is present", async () => {
		const dataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("png-bytes") })

		const result = await resolveImageMentions({
			text: "Please look at @/assets/cat.png",
			images: [],
			cwd: "/workspace",
		})

		expect(mockValidateImage).toHaveBeenCalled()
		expect(mockReadImageAsDataUrl).toHaveBeenCalledWith(path.resolve("/workspace", "assets/cat.png"))
		expect(result.text).toBe("Please look at @/assets/cat.png")
		expect(result.images).toEqual([dataUrl])
	})

	it("should support gif images (matching read_file)", async () => {
		const dataUrl = `data:image/gif;base64,${Buffer.from("gif-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("gif-bytes") })

		const result = await resolveImageMentions({
			text: "See @/animation.gif",
			images: [],
			cwd: "/workspace",
		})

		expect(result.images).toEqual([dataUrl])
	})

	it("should support svg images (matching read_file)", async () => {
		const dataUrl = `data:image/svg+xml;base64,${Buffer.from("svg-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("svg-bytes") })

		const result = await resolveImageMentions({
			text: "See @/icon.svg",
			images: [],
			cwd: "/workspace",
		})

		expect(result.images).toEqual([dataUrl])
	})

	it("should ignore non-image mentions", async () => {
		const result = await resolveImageMentions({
			text: "See @/src/index.ts",
			images: [],
			cwd: "/workspace",
		})

		expect(mockReadImageAsDataUrl).not.toHaveBeenCalled()
		expect(result.images).toEqual([])
	})

	it("should skip unreadable files (fail-soft)", async () => {
		mockReadImageAsDataUrl.mockRejectedValue(new Error("ENOENT"))

		const result = await resolveImageMentions({
			text: "See @/missing.webp",
			images: [],
			cwd: "/workspace",
		})

		expect(result.images).toEqual([])
	})

	it("should respect rooIgnoreController", async () => {
		const dataUrl = `data:image/jpeg;base64,${Buffer.from("jpg-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("jpg-bytes") })
		const rooIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(false),
		}

		const result = await resolveImageMentions({
			text: "See @/secret.jpg",
			images: [],
			cwd: "/workspace",
			rooIgnoreController,
		})

		expect(rooIgnoreController.validateAccess).toHaveBeenCalledWith("secret.jpg")
		expect(mockReadImageAsDataUrl).not.toHaveBeenCalled()
		expect(result.images).toEqual([])
	})

	it("should dedupe when mention repeats", async () => {
		const dataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("png-bytes") })

		const result = await resolveImageMentions({
			text: "@/a.png and again @/a.png",
			images: [],
			cwd: "/workspace",
		})

		expect(result.images).toHaveLength(1)
	})

	it("should skip images when supportsImages is false", async () => {
		const dataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("png-bytes") })

		const result = await resolveImageMentions({
			text: "See @/cat.png",
			images: [],
			cwd: "/workspace",
			supportsImages: false,
		})

		expect(mockReadImageAsDataUrl).not.toHaveBeenCalled()
		expect(result.images).toEqual([])
	})

	it("should skip images that exceed size limits", async () => {
		mockValidateImage.mockResolvedValue({
			isValid: false,
			reason: "size_limit",
			notice: "Image too large",
		})

		const result = await resolveImageMentions({
			text: "See @/huge.png",
			images: [],
			cwd: "/workspace",
		})

		expect(mockValidateImage).toHaveBeenCalled()
		expect(mockReadImageAsDataUrl).not.toHaveBeenCalled()
		expect(result.images).toEqual([])
	})

	it("should skip images that would exceed memory limit", async () => {
		mockValidateImage.mockResolvedValue({
			isValid: false,
			reason: "memory_limit",
			notice: "Would exceed memory limit",
		})

		const result = await resolveImageMentions({
			text: "See @/large.png",
			images: [],
			cwd: "/workspace",
		})

		expect(result.images).toEqual([])
	})

	it("should pass custom size limits to validation", async () => {
		const dataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
		mockReadImageAsDataUrl.mockResolvedValue({ dataUrl, buffer: Buffer.from("png-bytes") })

		await resolveImageMentions({
			text: "See @/cat.png",
			images: [],
			cwd: "/workspace",
			maxImageFileSize: 10,
			maxTotalImageSize: 50,
		})

		expect(mockValidateImage).toHaveBeenCalledWith(expect.any(String), true, 10, 50, 0)
	})
})

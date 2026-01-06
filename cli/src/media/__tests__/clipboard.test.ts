import {
	isClipboardSupported,
	// Domain logic functions (exported for testing)
	parseClipboardInfo,
	detectImageFormat,
	buildDataUrl,
	getUnsupportedClipboardPlatformMessage,
	getClipboardDir,
	generateClipboardFilename,
} from "../clipboard"

describe("clipboard utility", () => {
	describe("parseClipboardInfo (macOS clipboard info parsing)", () => {
		it("should detect PNG format", () => {
			expect(parseClipboardInfo("«class PNGf», 1234")).toEqual({ hasImage: true, format: "png" })
		})

		it("should detect JPEG format", () => {
			expect(parseClipboardInfo("«class JPEG», 5678")).toEqual({ hasImage: true, format: "jpeg" })
		})

		it("should detect TIFF format", () => {
			expect(parseClipboardInfo("TIFF picture, 9012")).toEqual({ hasImage: true, format: "tiff" })
		})

		it("should detect GIF format", () => {
			expect(parseClipboardInfo("«class GIFf», 3456")).toEqual({ hasImage: true, format: "gif" })
		})

		it("should return no image for text-only clipboard", () => {
			expect(parseClipboardInfo("«class utf8», 100")).toEqual({ hasImage: false, format: null })
		})

		it("should return no image for empty string", () => {
			expect(parseClipboardInfo("")).toEqual({ hasImage: false, format: null })
		})

		it("should handle multiple types and pick first image", () => {
			expect(parseClipboardInfo("«class PNGf», 1234, «class utf8», 100")).toEqual({
				hasImage: true,
				format: "png",
			})
		})
	})

	describe("detectImageFormat (format detection from bytes)", () => {
		it("should detect PNG from magic bytes", () => {
			const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			expect(detectImageFormat(pngBytes)).toBe("png")
		})

		it("should detect JPEG from magic bytes", () => {
			const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
			expect(detectImageFormat(jpegBytes)).toBe("jpeg")
		})

		it("should detect GIF from magic bytes", () => {
			const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
			expect(detectImageFormat(gifBytes)).toBe("gif")
		})

		it("should detect WebP from magic bytes", () => {
			const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
			expect(detectImageFormat(webpBytes)).toBe("webp")
		})

		it("should return null for unknown format", () => {
			const unknownBytes = Buffer.from([0x00, 0x01, 0x02, 0x03])
			expect(detectImageFormat(unknownBytes)).toBe(null)
		})

		it("should return null for empty buffer", () => {
			expect(detectImageFormat(Buffer.from([]))).toBe(null)
		})
	})

	describe("buildDataUrl", () => {
		it("should build PNG data URL", () => {
			const data = Buffer.from([0x89, 0x50, 0x4e, 0x47])
			const result = buildDataUrl(data, "png")
			expect(result).toBe(`data:image/png;base64,${data.toString("base64")}`)
		})

		it("should build JPEG data URL", () => {
			const data = Buffer.from([0xff, 0xd8, 0xff])
			const result = buildDataUrl(data, "jpeg")
			expect(result).toBe(`data:image/jpeg;base64,${data.toString("base64")}`)
		})

		it("should handle arbitrary binary data", () => {
			const data = Buffer.from("Hello, World!")
			const result = buildDataUrl(data, "png")
			expect(result).toMatch(/^data:image\/png;base64,/)
			expect(result).toContain(data.toString("base64"))
		})
	})

	describe("getUnsupportedClipboardPlatformMessage", () => {
		it("should mention macOS", () => {
			const msg = getUnsupportedClipboardPlatformMessage()
			expect(msg).toContain("macOS")
		})

		it("should mention @path/to/image.png alternative", () => {
			const msg = getUnsupportedClipboardPlatformMessage()
			expect(msg).toContain("@")
			expect(msg.toLowerCase()).toContain("image")
		})
	})

	describe("isClipboardSupported (platform detection)", () => {
		const originalPlatform = process.platform

		afterEach(() => {
			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("should return true for darwin", async () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			expect(await isClipboardSupported()).toBe(true)
		})

		it("should return false for win32", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			expect(await isClipboardSupported()).toBe(false)
		})
	})

	describe("getClipboardDir", () => {
		it("should return clipboard directory in system temp", () => {
			const result = getClipboardDir()
			expect(result).toContain("kilocode-clipboard")
			// Should be in temp directory, not a project directory
			expect(result).not.toContain(".kilocode-clipboard")
		})
	})

	describe("generateClipboardFilename", () => {
		it("should generate unique filenames", () => {
			const filename1 = generateClipboardFilename("png")
			const filename2 = generateClipboardFilename("png")
			expect(filename1).not.toBe(filename2)
		})

		it("should include correct extension", () => {
			const pngFilename = generateClipboardFilename("png")
			const jpegFilename = generateClipboardFilename("jpeg")
			expect(pngFilename).toMatch(/\.png$/)
			expect(jpegFilename).toMatch(/\.jpeg$/)
		})

		it("should start with clipboard- prefix", () => {
			const filename = generateClipboardFilename("png")
			expect(filename).toMatch(/^clipboard-/)
		})

		it("should include timestamp", () => {
			const before = Date.now()
			const filename = generateClipboardFilename("png")
			const after = Date.now()

			// Extract timestamp from filename (clipboard-TIMESTAMP-RANDOM.ext)
			const match = filename.match(/^clipboard-(\d+)-/)
			expect(match).toBeTruthy()
			const timestamp = parseInt(match![1], 10)
			expect(timestamp).toBeGreaterThanOrEqual(before)
			expect(timestamp).toBeLessThanOrEqual(after)
		})
	})
})

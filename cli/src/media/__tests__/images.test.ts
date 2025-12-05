import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import {
	isImagePath,
	getMimeType,
	readImageAsDataUrl,
	processImagePaths,
	SUPPORTED_IMAGE_EXTENSIONS,
	MAX_IMAGE_SIZE_BYTES,
} from "../images"

describe("images utility", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "images-test-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("isImagePath", () => {
		it("should return true for supported image extensions", () => {
			expect(isImagePath("image.png")).toBe(true)
			expect(isImagePath("image.PNG")).toBe(true)
			expect(isImagePath("image.jpg")).toBe(true)
			expect(isImagePath("image.JPG")).toBe(true)
			expect(isImagePath("image.jpeg")).toBe(true)
			expect(isImagePath("image.JPEG")).toBe(true)
			expect(isImagePath("image.webp")).toBe(true)
			expect(isImagePath("image.WEBP")).toBe(true)
			expect(isImagePath("image.gif")).toBe(true)
			expect(isImagePath("image.GIF")).toBe(true)
			expect(isImagePath("image.tiff")).toBe(true)
			expect(isImagePath("image.TIFF")).toBe(true)
		})

		it("should return false for non-image extensions", () => {
			expect(isImagePath("file.txt")).toBe(false)
			expect(isImagePath("file.ts")).toBe(false)
			expect(isImagePath("file.js")).toBe(false)
			expect(isImagePath("file.pdf")).toBe(false)
			expect(isImagePath("file.bmp")).toBe(false) // BMP not supported
			expect(isImagePath("file")).toBe(false)
		})

		it("should handle paths with directories", () => {
			expect(isImagePath("/path/to/image.png")).toBe(true)
			expect(isImagePath("./relative/path/image.jpg")).toBe(true)
			expect(isImagePath("../parent/image.webp")).toBe(true)
		})

		it("should handle paths with dots in filename", () => {
			expect(isImagePath("my.file.name.png")).toBe(true)
			expect(isImagePath("version.1.2.3.jpg")).toBe(true)
		})
	})

	describe("getMimeType", () => {
		it("should return correct MIME type for PNG", () => {
			expect(getMimeType("image.png")).toBe("image/png")
			expect(getMimeType("image.PNG")).toBe("image/png")
		})

		it("should return correct MIME type for JPEG", () => {
			expect(getMimeType("image.jpg")).toBe("image/jpeg")
			expect(getMimeType("image.jpeg")).toBe("image/jpeg")
			expect(getMimeType("image.JPG")).toBe("image/jpeg")
		})

		it("should return correct MIME type for WebP", () => {
			expect(getMimeType("image.webp")).toBe("image/webp")
		})

		it("should return correct MIME type for GIF and TIFF", () => {
			expect(getMimeType("image.gif")).toBe("image/gif")
			expect(getMimeType("image.tiff")).toBe("image/tiff")
		})

		it("should throw for unsupported types", () => {
			expect(() => getMimeType("image.bmp")).toThrow("Unsupported image type")
			expect(() => getMimeType("image.svg")).toThrow("Unsupported image type")
		})
	})

	describe("readImageAsDataUrl", () => {
		it("should read a PNG file and return data URL", async () => {
			// Create a minimal valid PNG (1x1 red pixel)
			const pngData = Buffer.from([
				0x89,
				0x50,
				0x4e,
				0x47,
				0x0d,
				0x0a,
				0x1a,
				0x0a, // PNG signature
				0x00,
				0x00,
				0x00,
				0x0d, // IHDR length
				0x49,
				0x48,
				0x44,
				0x52, // IHDR type
				0x00,
				0x00,
				0x00,
				0x01, // width = 1
				0x00,
				0x00,
				0x00,
				0x01, // height = 1
				0x08,
				0x02, // bit depth 8, color type 2 (RGB)
				0x00,
				0x00,
				0x00, // compression, filter, interlace
				0x90,
				0x77,
				0x53,
				0xde, // CRC
				0x00,
				0x00,
				0x00,
				0x0c, // IDAT length
				0x49,
				0x44,
				0x41,
				0x54, // IDAT type
				0x08,
				0xd7,
				0x63,
				0xf8,
				0xcf,
				0xc0,
				0x00,
				0x00,
				0x01,
				0x01,
				0x01,
				0x00, // compressed data
				0x18,
				0xdd,
				0x8d,
				0xb5, // CRC
				0x00,
				0x00,
				0x00,
				0x00, // IEND length
				0x49,
				0x45,
				0x4e,
				0x44, // IEND type
				0xae,
				0x42,
				0x60,
				0x82, // CRC
			])

			const imagePath = path.join(tempDir, "test.png")
			await fs.writeFile(imagePath, pngData)

			const dataUrl = await readImageAsDataUrl(imagePath)

			expect(dataUrl).toMatch(/^data:image\/png;base64,/)
			expect(dataUrl.length).toBeGreaterThan("data:image/png;base64,".length)
		})

		it("should resolve relative paths from basePath", async () => {
			const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // Minimal PNG header
			const imagePath = path.join(tempDir, "relative.png")
			await fs.writeFile(imagePath, pngData)

			const dataUrl = await readImageAsDataUrl("relative.png", tempDir)

			expect(dataUrl).toMatch(/^data:image\/png;base64,/)
		})

		it("should throw for non-existent files", async () => {
			await expect(readImageAsDataUrl("/non/existent/path.png")).rejects.toThrow("Image file not found")
		})

		it("should throw for non-image files", async () => {
			const textPath = path.join(tempDir, "test.txt")
			await fs.writeFile(textPath, "Hello, world!")

			await expect(readImageAsDataUrl(textPath)).rejects.toThrow("Not a supported image type")
		})

		it("should throw for files larger than the maximum size", async () => {
			const largeBuffer = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1, 0xff)
			const largePath = path.join(tempDir, "too-big.png")
			await fs.writeFile(largePath, largeBuffer)

			await expect(readImageAsDataUrl(largePath)).rejects.toThrow("Image file is too large")
		})
	})

	describe("processImagePaths", () => {
		it("should process multiple image paths", async () => {
			// Create test images
			const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			const image1 = path.join(tempDir, "image1.png")
			const image2 = path.join(tempDir, "image2.png")
			await fs.writeFile(image1, pngData)
			await fs.writeFile(image2, pngData)

			const result = await processImagePaths([image1, image2])

			expect(result.images).toHaveLength(2)
			expect(result.errors).toHaveLength(0)
			expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
			expect(result.images[1]).toMatch(/^data:image\/png;base64,/)
		})

		it("should collect errors for failed paths", async () => {
			const result = await processImagePaths(["/non/existent.png", "/another/missing.jpg"])

			expect(result.images).toHaveLength(0)
			expect(result.errors).toHaveLength(2)
			expect(result.errors[0]).toMatchObject({
				path: "/non/existent.png",
			})
		})

		it("should partially succeed when some paths fail", async () => {
			const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			const validPath = path.join(tempDir, "valid.png")
			await fs.writeFile(validPath, pngData)

			const result = await processImagePaths([validPath, "/non/existent.png"])

			expect(result.images).toHaveLength(1)
			expect(result.errors).toHaveLength(1)
		})
	})

	describe("SUPPORTED_IMAGE_EXTENSIONS", () => {
		it("should contain expected extensions", () => {
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".png")
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".jpg")
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".jpeg")
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".webp")
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".gif")
			expect(SUPPORTED_IMAGE_EXTENSIONS).toContain(".tiff")
		})
	})
})

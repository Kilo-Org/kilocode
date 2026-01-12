import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync } from "fs"
import { extname } from "node:path"

// Mock fs.existsSync
vi.mock("fs", () => ({
	existsSync: vi.fn(),
}))

/**
 * Tests for the --attach flag behavior.
 *
 * The --attach flag allows users to attach files (currently images) to CLI prompts
 * in auto/yolo mode or json-io mode.
 */
describe("CLI --attach flag", () => {
	const supportedExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff"]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Flag accumulation", () => {
		/**
		 * Test the Commander.js accumulator function for --attach flag
		 */
		function accumulateAttachments(value: string, previous: string[]): string[] {
			return previous.concat([value])
		}

		it("should accept a single --attach flag", () => {
			const result = accumulateAttachments("./screenshot.png", [])
			expect(result).toEqual(["./screenshot.png"])
		})

		it("should accumulate multiple --attach flags", () => {
			let attachments: string[] = []
			attachments = accumulateAttachments("./screenshot.png", attachments)
			attachments = accumulateAttachments("./diagram.png", attachments)
			attachments = accumulateAttachments("./photo.jpg", attachments)

			expect(attachments).toEqual(["./screenshot.png", "./diagram.png", "./photo.jpg"])
			expect(attachments.length).toBe(3)
		})

		it("should start with an empty array by default", () => {
			const defaultValue: string[] = []
			expect(defaultValue).toEqual([])
		})
	})

	describe("Mode validation", () => {
		/**
		 * Mirrors the validation logic from cli/src/index.ts
		 */
		function validateAttachRequiresAutoOrJsonIo(options: { attach?: string[]; auto?: boolean; jsonIo?: boolean }): {
			valid: boolean
			error?: string
		} {
			const attachments = options.attach || []
			if (attachments.length > 0) {
				if (!options.auto && !options.jsonIo) {
					return {
						valid: false,
						error: "Error: --attach option requires --auto or --json-io flag",
					}
				}
			}
			return { valid: true }
		}

		it("should reject --attach without --auto or --json-io", () => {
			const result = validateAttachRequiresAutoOrJsonIo({
				attach: ["./screenshot.png"],
			})
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: --attach option requires --auto or --json-io flag")
		})

		it("should accept --attach with --auto flag", () => {
			const result = validateAttachRequiresAutoOrJsonIo({
				attach: ["./screenshot.png"],
				auto: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept --attach with --json-io flag", () => {
			const result = validateAttachRequiresAutoOrJsonIo({
				attach: ["./screenshot.png"],
				jsonIo: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept --attach with both --auto and --json-io flags", () => {
			const result = validateAttachRequiresAutoOrJsonIo({
				attach: ["./screenshot.png"],
				auto: true,
				jsonIo: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept when no attachments are provided", () => {
			const result = validateAttachRequiresAutoOrJsonIo({})
			expect(result.valid).toBe(true)
		})

		it("should accept when attachments array is empty", () => {
			const result = validateAttachRequiresAutoOrJsonIo({ attach: [] })
			expect(result.valid).toBe(true)
		})
	})

	describe("File existence validation", () => {
		/**
		 * Mirrors the file existence validation from cli/src/index.ts
		 */
		function validateAttachmentExists(attachPath: string): { valid: boolean; error?: string } {
			if (!existsSync(attachPath)) {
				return {
					valid: false,
					error: `Error: Attachment file not found: ${attachPath}`,
				}
			}
			return { valid: true }
		}

		it("should error on non-existent attachment file", () => {
			vi.mocked(existsSync).mockReturnValue(false)

			const result = validateAttachmentExists("/non/existent/path.png")
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: Attachment file not found: /non/existent/path.png")
		})

		it("should accept existing attachment file", () => {
			vi.mocked(existsSync).mockReturnValue(true)

			const result = validateAttachmentExists("./existing-image.png")
			expect(result.valid).toBe(true)
		})
	})

	describe("File format validation", () => {
		/**
		 * Mirrors the file format validation from cli/src/index.ts
		 */
		function validateAttachmentFormat(attachPath: string): { valid: boolean; error?: string } {
			const ext = extname(attachPath).toLowerCase()
			if (!supportedExtensions.includes(ext)) {
				return {
					valid: false,
					error: `Error: Unsupported attachment format "${ext}". Currently supported: .png, .jpg, .jpeg, .webp, .gif, .tiff. Other file types can be read using @path mentions or the read_file tool.`,
				}
			}
			return { valid: true }
		}

		it("should error on unsupported file format with helpful message", () => {
			const result = validateAttachmentFormat("./document.pdf")
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unsupported attachment format ".pdf"')
			expect(result.error).toContain("Currently supported: .png, .jpg, .jpeg, .webp, .gif, .tiff")
			expect(result.error).toContain("Other file types can be read using @path mentions or the read_file tool")
		})

		it("should error on text file format", () => {
			const result = validateAttachmentFormat("./readme.txt")
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unsupported attachment format ".txt"')
		})

		it("should error on unknown extension", () => {
			const result = validateAttachmentFormat("./file.xyz")
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unsupported attachment format ".xyz"')
		})

		it("should accept .png format", () => {
			const result = validateAttachmentFormat("./image.png")
			expect(result.valid).toBe(true)
		})

		it("should accept .jpg format", () => {
			const result = validateAttachmentFormat("./photo.jpg")
			expect(result.valid).toBe(true)
		})

		it("should accept .jpeg format", () => {
			const result = validateAttachmentFormat("./photo.jpeg")
			expect(result.valid).toBe(true)
		})

		it("should accept .webp format", () => {
			const result = validateAttachmentFormat("./image.webp")
			expect(result.valid).toBe(true)
		})

		it("should accept .gif format", () => {
			const result = validateAttachmentFormat("./animation.gif")
			expect(result.valid).toBe(true)
		})

		it("should accept .tiff format", () => {
			const result = validateAttachmentFormat("./scan.tiff")
			expect(result.valid).toBe(true)
		})

		it("should handle case-insensitive extensions", () => {
			expect(validateAttachmentFormat("./image.PNG").valid).toBe(true)
			expect(validateAttachmentFormat("./image.Jpg").valid).toBe(true)
			expect(validateAttachmentFormat("./image.JPEG").valid).toBe(true)
			expect(validateAttachmentFormat("./image.WebP").valid).toBe(true)
			expect(validateAttachmentFormat("./image.GIF").valid).toBe(true)
			expect(validateAttachmentFormat("./image.TIFF").valid).toBe(true)
		})
	})

	describe("Complete validation flow", () => {
		/**
		 * Mirrors the complete validation flow from cli/src/index.ts
		 */
		function validateAttachments(options: { attach?: string[]; auto?: boolean; jsonIo?: boolean }): {
			valid: boolean
			errors: string[]
		} {
			const errors: string[] = []
			const attachments = options.attach || []

			if (attachments.length === 0) {
				return { valid: true, errors: [] }
			}

			// Validate mode requirement
			if (!options.auto && !options.jsonIo) {
				errors.push("Error: --attach option requires --auto or --json-io flag")
				return { valid: false, errors }
			}

			// Validate each attachment
			for (const attachPath of attachments) {
				// Check existence
				if (!existsSync(attachPath)) {
					errors.push(`Error: Attachment file not found: ${attachPath}`)
					continue
				}

				// Check format
				const ext = extname(attachPath).toLowerCase()
				if (!supportedExtensions.includes(ext)) {
					errors.push(
						`Error: Unsupported attachment format "${ext}". Currently supported: .png, .jpg, .jpeg, .webp, .gif, .tiff. Other file types can be read using @path mentions or the read_file tool.`,
					)
				}
			}

			return { valid: errors.length === 0, errors }
		}

		it("should validate multiple attachments", () => {
			vi.mocked(existsSync).mockReturnValue(true)

			const result = validateAttachments({
				attach: ["./image1.png", "./image2.jpg", "./image3.webp"],
				auto: true,
			})

			expect(result.valid).toBe(true)
			expect(result.errors).toEqual([])
		})

		it("should report all validation errors", () => {
			vi.mocked(existsSync)
				.mockReturnValueOnce(true) // first file exists
				.mockReturnValueOnce(false) // second file doesn't exist

			const result = validateAttachments({
				attach: ["./invalid.pdf", "./missing.png"],
				auto: true,
			})

			expect(result.valid).toBe(false)
			expect(result.errors.length).toBe(2)
			expect(result.errors[0]).toContain("Unsupported attachment format")
			expect(result.errors[1]).toContain("Attachment file not found")
		})
	})
})

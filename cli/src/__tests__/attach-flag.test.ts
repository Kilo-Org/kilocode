import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync } from "fs"
import {
	accumulateAttachments,
	validateAttachmentExists,
	validateAttachmentFormat,
	validateAttachments,
	validateAttachRequiresAuto,
} from "../validation/attachments.js"
import { SUPPORTED_IMAGE_EXTENSIONS } from "../media/images.js"

// Mock fs.existsSync
vi.mock("fs", () => ({
	existsSync: vi.fn(),
}))

/**
 * Tests for the --attach flag behavior.
 *
 * The --attach flag allows users to attach files (currently images) to CLI prompts
 * in auto mode.
 */
describe("CLI --attach flag", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Flag accumulation", () => {
		/**
		 * Tests the real accumulateAttachments function from validation/attachments.ts
		 * This function is used by Commander.js to accumulate --attach flags
		 */
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

		it("should not mutate the previous array", () => {
			const previous = ["./first.png"]
			const result = accumulateAttachments("./second.png", previous)

			// Result should contain both
			expect(result).toEqual(["./first.png", "./second.png"])
			// Original array should be unchanged
			expect(previous).toEqual(["./first.png"])
		})
	})

	describe("Mode validation", () => {
		it("should reject --attach without --auto or --json-io", () => {
			const result = validateAttachRequiresAuto({
				attach: ["./screenshot.png"],
			})
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: --attach option requires --auto or --json-io flag")
		})

		it("should accept --attach with --auto flag", () => {
			const result = validateAttachRequiresAuto({
				attach: ["./screenshot.png"],
				auto: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept --attach with --json-io flag", () => {
			const result = validateAttachRequiresAuto({
				attach: ["./screenshot.png"],
				jsonIo: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept --attach with both --auto and --json-io flags", () => {
			const result = validateAttachRequiresAuto({
				attach: ["./screenshot.png"],
				auto: true,
				jsonIo: true,
			})
			expect(result.valid).toBe(true)
		})

		it("should accept when no attachments are provided", () => {
			const result = validateAttachRequiresAuto({})
			expect(result.valid).toBe(true)
		})

		it("should accept when attachments array is empty", () => {
			const result = validateAttachRequiresAuto({ attach: [] })
			expect(result.valid).toBe(true)
		})
	})

	describe("File existence validation", () => {
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
		it("should error on unsupported file format with helpful message", () => {
			const result = validateAttachmentFormat("./document.pdf")
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unsupported attachment format ".pdf"')
			expect(result.error).toContain("Currently supported:")
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

		it.each(SUPPORTED_IMAGE_EXTENSIONS)("should accept %s format", (ext) => {
			const result = validateAttachmentFormat(`./image${ext}`)
			expect(result.valid).toBe(true)
		})

		it.each(SUPPORTED_IMAGE_EXTENSIONS)("should handle case-insensitive %s extension", (ext) => {
			const upperExt = ext.toUpperCase()
			const result = validateAttachmentFormat(`./image${upperExt}`)
			expect(result.valid).toBe(true)
		})
	})

	describe("Complete validation flow", () => {
		it("should return valid for empty attachments array", () => {
			const result = validateAttachments([])
			expect(result.valid).toBe(true)
			expect(result.errors).toEqual([])
		})

		it("should validate multiple attachments", () => {
			vi.mocked(existsSync).mockReturnValue(true)

			const result = validateAttachments(["./image1.png", "./image2.jpg", "./image3.webp"])

			expect(result.valid).toBe(true)
			expect(result.errors).toEqual([])
		})

		it("should report file not found error", () => {
			vi.mocked(existsSync).mockReturnValue(false)

			const result = validateAttachments(["./missing.png"])

			expect(result.valid).toBe(false)
			expect(result.errors.length).toBe(1)
			expect(result.errors[0]).toContain("Attachment file not found")
		})

		it("should report unsupported format error", () => {
			vi.mocked(existsSync).mockReturnValue(true)

			const result = validateAttachments(["./document.pdf"])

			expect(result.valid).toBe(false)
			expect(result.errors.length).toBe(1)
			expect(result.errors[0]).toContain("Unsupported attachment format")
		})

		it("should report all validation errors", () => {
			vi.mocked(existsSync)
				.mockReturnValueOnce(true) // first file exists
				.mockReturnValueOnce(false) // second file doesn't exist

			const result = validateAttachments(["./invalid.pdf", "./missing.png"])

			expect(result.valid).toBe(false)
			expect(result.errors.length).toBe(2)
			expect(result.errors[0]).toContain("Unsupported attachment format")
			expect(result.errors[1]).toContain("Attachment file not found")
		})

		it("should skip format validation for non-existent files", () => {
			vi.mocked(existsSync).mockReturnValue(false)

			// Even though the file has a valid extension, we should get a "not found" error
			const result = validateAttachments(["./missing.png"])

			expect(result.valid).toBe(false)
			expect(result.errors.length).toBe(1)
			expect(result.errors[0]).toContain("Attachment file not found")
			expect(result.errors[0]).not.toContain("Unsupported attachment format")
		})
	})
})

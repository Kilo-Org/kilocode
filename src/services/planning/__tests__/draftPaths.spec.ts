import { describe, it, expect } from "vitest"
import {
	DRAFT_PROTOCOL,
	DRAFT_SCHEME_NAME,
	isDraftPath,
	draftPathToFilename,
	filenameToDraftPath,
	normalizeDraftPath,
} from "../draftPaths"

describe("draftPaths", () => {
	describe("DRAFT_PROTOCOL", () => {
		it("should equal 'draft://'", () => {
			expect(DRAFT_PROTOCOL).toBe("draft://")
		})
	})

	describe("DRAFT_SCHEME_NAME", () => {
		it("should equal 'draft'", () => {
			expect(DRAFT_SCHEME_NAME).toBe("draft")
		})
	})

	describe("isDraftPath", () => {
		it("should return true for draft:// paths (canonical format)", () => {
			expect(isDraftPath("draft://test.md")).toBe(true)
			expect(isDraftPath("draft://my-document")).toBe(true)
		})

		it("should return true for draft:/// paths (AI triple-slash format)", () => {
			expect(isDraftPath("draft:///test.md")).toBe(true)
			expect(isDraftPath("draft:///path/to/file.md")).toBe(true)
		})

		it("should return true for draft:/ paths (VSCode normalized format)", () => {
			expect(isDraftPath("draft:/test.md")).toBe(true)
			expect(isDraftPath("draft:/implementation-plan.md")).toBe(true)
			expect(isDraftPath("draft:/path/to/file.md")).toBe(true)
		})

		it("should return false for non-draft paths", () => {
			expect(isDraftPath("/path/to/file.md")).toBe(false)
			expect(isDraftPath("file://path/to/file.md")).toBe(false)
			expect(isDraftPath("test.md")).toBe(false)
		})
	})

	describe("normalizeDraftPath", () => {
		it("should normalize draft:// paths (already canonical)", () => {
			expect(normalizeDraftPath("draft://test.md")).toBe("draft://test.md")
			expect(normalizeDraftPath("draft://path/to/file.md")).toBe("draft://path/to/file.md")
		})

		it("should normalize draft:/// paths (AI triple-slash format)", () => {
			expect(normalizeDraftPath("draft:///test.md")).toBe("draft://test.md")
			expect(normalizeDraftPath("draft:///implementation-plan.md")).toBe("draft://implementation-plan.md")
		})

		it("should normalize draft:/ paths (VSCode normalized format)", () => {
			expect(normalizeDraftPath("draft:/test.md")).toBe("draft://test.md")
			expect(normalizeDraftPath("draft:/implementation-plan.md")).toBe("draft://implementation-plan.md")
		})

		it("should throw error for non-draft paths", () => {
			expect(() => normalizeDraftPath("test.md")).toThrow("Invalid draft path: test.md")
			expect(() => normalizeDraftPath("/path/to/file.md")).toThrow()
		})
	})

	describe("draftPathToFilename", () => {
		it("should extract filename from draft:// path (canonical)", () => {
			expect(draftPathToFilename("draft://test.md")).toBe("test.md")
			expect(draftPathToFilename("draft://my-document.md")).toBe("my-document.md")
		})

		it("should extract filename from draft:/// path (AI format)", () => {
			expect(draftPathToFilename("draft:///test.md")).toBe("test.md")
			expect(draftPathToFilename("draft:///path/to/file.md")).toBe("path/to/file.md")
		})

		it("should extract filename from draft:/ path (VSCode normalized)", () => {
			expect(draftPathToFilename("draft:/test.md")).toBe("test.md")
			expect(draftPathToFilename("draft:/implementation-plan.md")).toBe("implementation-plan.md")
			expect(draftPathToFilename("draft:/path/to/file.md")).toBe("path/to/file.md")
		})

		it("should throw error for invalid draft paths", () => {
			expect(() => draftPathToFilename("test.md")).toThrow("Invalid draft path: test.md")
			expect(() => draftPathToFilename("/path/to/file.md")).toThrow()
		})
	})

	describe("filenameToDraftPath", () => {
		it("should convert filename to canonical draft:// path", () => {
			expect(filenameToDraftPath("test.md")).toBe("draft://test.md")
			expect(filenameToDraftPath("my-document")).toBe("draft://my-document")
		})

		it("should strip leading slashes from filename", () => {
			expect(filenameToDraftPath("/test.md")).toBe("draft://test.md")
			expect(filenameToDraftPath("//test.md")).toBe("draft://test.md")
			expect(filenameToDraftPath("///test.md")).toBe("draft://test.md")
		})

		it("should handle paths with directories", () => {
			expect(filenameToDraftPath("path/to/file.md")).toBe("draft://path/to/file.md")
			expect(filenameToDraftPath("/path/to/file.md")).toBe("draft://path/to/file.md")
		})
	})

	describe("roundtrip conversion", () => {
		it("should maintain path integrity through roundtrip", () => {
			const original = "test.md"
			const draftPath = filenameToDraftPath(original)
			const result = draftPathToFilename(draftPath)
			expect(result).toBe(original)
		})

		it("should handle complex paths through roundtrip", () => {
			const original = "path/to/my-document.md"
			const draftPath = filenameToDraftPath(original)
			expect(draftPath).toBe("draft://path/to/my-document.md")
			const result = draftPathToFilename(draftPath)
			expect(result).toBe(original)
		})

		it("should normalize any variant through roundtrip", () => {
			// AI gives us triple-slash
			const aiPath = "draft:///implementation-plan.md"
			const normalized = normalizeDraftPath(aiPath)
			expect(normalized).toBe("draft://implementation-plan.md")

			// VSCode gives us single-slash
			const vscodePath = "draft:/implementation-plan.md"
			const normalizedVscode = normalizeDraftPath(vscodePath)
			expect(normalizedVscode).toBe("draft://implementation-plan.md")

			// Both extract same filename
			expect(draftPathToFilename(aiPath)).toBe("implementation-plan.md")
			expect(draftPathToFilename(vscodePath)).toBe("implementation-plan.md")
		})
	})
})

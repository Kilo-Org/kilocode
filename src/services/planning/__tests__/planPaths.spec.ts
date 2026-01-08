// kilocode_change - new file: Tests for plan path utilities
import { describe, it, expect } from "vitest"
import {
	PLAN_PROTOCOL,
	PLAN_SCHEME_NAME,
	isPlanPath,
	planPathToFilename,
	filenameToPlanPath,
	normalizePlanPath,
} from "../planPaths"

describe("planPaths", () => {
	describe("PLAN_PROTOCOL", () => {
		it("should equal 'plan://'", () => {
			expect(PLAN_PROTOCOL).toBe("plan://")
		})
	})

	describe("PLAN_SCHEME_NAME", () => {
		it("should equal 'plan'", () => {
			expect(PLAN_SCHEME_NAME).toBe("plan")
		})
	})

	describe("isPlanPath", () => {
		it("should return true for plan:// paths (canonical format)", () => {
			expect(isPlanPath("plan://test.md")).toBe(true)
			expect(isPlanPath("plan://my-document")).toBe(true)
		})

		it("should return true for plan:/// paths (AI triple-slash format)", () => {
			expect(isPlanPath("plan:///test.md")).toBe(true)
			expect(isPlanPath("plan:///path/to/file.md")).toBe(true)
		})

		it("should return true for plan:/ paths (VSCode normalized format)", () => {
			expect(isPlanPath("plan:/test.md")).toBe(true)
			expect(isPlanPath("plan:/implementation-plan.md")).toBe(true)
			expect(isPlanPath("plan:/path/to/file.md")).toBe(true)
		})

		it("should return false for non-plan paths", () => {
			expect(isPlanPath("/path/to/file.md")).toBe(false)
			expect(isPlanPath("file://path/to/file.md")).toBe(false)
			expect(isPlanPath("test.md")).toBe(false)
		})
	})

	describe("normalizePlanPath", () => {
		it("should normalize plan:// paths (already canonical)", () => {
			expect(normalizePlanPath("plan://test.md")).toBe("plan://test.md")
			expect(normalizePlanPath("plan://path/to/file.md")).toBe("plan://path/to/file.md")
		})

		it("should normalize plan:/// paths (AI triple-slash format)", () => {
			expect(normalizePlanPath("plan:///test.md")).toBe("plan://test.md")
			expect(normalizePlanPath("plan:///implementation-plan.md")).toBe("plan://implementation-plan.md")
		})

		it("should normalize plan:/ paths (VSCode normalized format)", () => {
			expect(normalizePlanPath("plan:/test.md")).toBe("plan://test.md")
			expect(normalizePlanPath("plan:/implementation-plan.md")).toBe("plan://implementation-plan.md")
		})

		it("should throw error for non-plan paths", () => {
			expect(() => normalizePlanPath("test.md")).toThrow("Invalid plan path: test.md")
			expect(() => normalizePlanPath("/path/to/file.md")).toThrow()
		})
	})

	describe("planPathToFilename", () => {
		it("should extract filename from plan:// path (canonical)", () => {
			expect(planPathToFilename("plan://test.md")).toBe("test.md")
			expect(planPathToFilename("plan://my-document.md")).toBe("my-document.md")
		})

		it("should extract filename from plan:/// path (AI format)", () => {
			expect(planPathToFilename("plan:///test.md")).toBe("test.md")
			expect(planPathToFilename("plan:///path/to/file.md")).toBe("path/to/file.md")
		})

		it("should extract filename from plan:/ path (VSCode normalized)", () => {
			expect(planPathToFilename("plan:/test.md")).toBe("test.md")
			expect(planPathToFilename("plan:/implementation-plan.md")).toBe("implementation-plan.md")
			expect(planPathToFilename("plan:/path/to/file.md")).toBe("path/to/file.md")
		})

		it("should throw error for invalid plan paths", () => {
			expect(() => planPathToFilename("test.md")).toThrow("Invalid plan path: test.md")
			expect(() => planPathToFilename("/path/to/file.md")).toThrow()
		})
	})

	describe("filenameToPlanPath", () => {
		it("should convert filename to canonical plan:// path", () => {
			expect(filenameToPlanPath("test.md")).toBe("plan://test.md")
			expect(filenameToPlanPath("my-document")).toBe("plan://my-document")
		})

		it("should strip leading slashes from filename", () => {
			expect(filenameToPlanPath("/test.md")).toBe("plan://test.md")
			expect(filenameToPlanPath("//test.md")).toBe("plan://test.md")
			expect(filenameToPlanPath("///test.md")).toBe("plan://test.md")
		})

		it("should handle paths with directories", () => {
			expect(filenameToPlanPath("path/to/file.md")).toBe("plan://path/to/file.md")
			expect(filenameToPlanPath("/path/to/file.md")).toBe("plan://path/to/file.md")
		})
	})

	describe("roundtrip conversion", () => {
		it("should maintain path integrity through roundtrip", () => {
			const original = "test.md"
			const planPath = filenameToPlanPath(original)
			const result = planPathToFilename(planPath)
			expect(result).toBe(original)
		})

		it("should handle complex paths through roundtrip", () => {
			const original = "path/to/my-document.md"
			const planPath = filenameToPlanPath(original)
			expect(planPath).toBe("plan://path/to/my-document.md")
			const result = planPathToFilename(planPath)
			expect(result).toBe(original)
		})

		it("should normalize any variant through roundtrip", () => {
			// AI gives us triple-slash
			const aiPath = "plan:///implementation-plan.md"
			const normalized = normalizePlanPath(aiPath)
			expect(normalized).toBe("plan://implementation-plan.md")

			// VSCode gives us single-slash
			const vscodePath = "plan:/implementation-plan.md"
			const normalizedVscode = normalizePlanPath(vscodePath)
			expect(normalizedVscode).toBe("plan://implementation-plan.md")

			// Both extract same filename
			expect(planPathToFilename(aiPath)).toBe("implementation-plan.md")
			expect(planPathToFilename(vscodePath)).toBe("implementation-plan.md")
		})
	})
})

/**
 * Tests for isBaseBranch functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { execSync } from "child_process"
import { isBaseBranch } from "../git-utils"

// Mock child_process
vi.mock("child_process", () => ({
	execSync: vi.fn(),
}))

describe("isBaseBranch", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("without workspace path", () => {
		it("should return true for main", () => {
			expect(isBaseBranch("main")).toBe(true)
		})

		it("should return true for master", () => {
			expect(isBaseBranch("master")).toBe(true)
		})

		it("should return true for develop", () => {
			expect(isBaseBranch("develop")).toBe(true)
		})

		it("should return true for development", () => {
			expect(isBaseBranch("development")).toBe(true)
		})

		it("should be case insensitive for common branches", () => {
			expect(isBaseBranch("MAIN")).toBe(true)
			expect(isBaseBranch("Master")).toBe(true)
			expect(isBaseBranch("DEVELOP")).toBe(true)
		})

		it("should return false for feature branches", () => {
			expect(isBaseBranch("feature/new-api")).toBe(false)
			expect(isBaseBranch("bugfix/issue-123")).toBe(false)
			expect(isBaseBranch("canary")).toBe(false)
		})
	})

	describe("with workspace path", () => {
		it("should return true for common base branches even without checking remote", () => {
			expect(isBaseBranch("main", workspacePath)).toBe(true)
			expect(isBaseBranch("master", workspacePath)).toBe(true)
			expect(isBaseBranch("develop", workspacePath)).toBe(true)
		})

		it("should return true when branch matches remote default", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/canary\n")

			const result = isBaseBranch("canary", workspacePath)

			expect(result).toBe(true)
			expect(execSync).toHaveBeenCalledWith("git symbolic-ref refs/remotes/origin/HEAD", {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})
		})

		it("should be case insensitive when comparing with remote default", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/Canary\n")

			expect(isBaseBranch("canary", workspacePath)).toBe(true)
			expect(isBaseBranch("CANARY", workspacePath)).toBe(true)
			expect(isBaseBranch("Canary", workspacePath)).toBe(true)
		})

		it("should return true for production when it's the remote default", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/production\n")

			expect(isBaseBranch("production", workspacePath)).toBe(true)
		})

		it("should return false when branch doesn't match remote default", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/main\n")

			expect(isBaseBranch("feature/test", workspacePath)).toBe(false)
		})

		it("should return false when remote default cannot be determined", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("No remote")
			})

			expect(isBaseBranch("canary", workspacePath)).toBe(false)
		})

		it("should handle remote default check failure gracefully", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("Git error")
			})

			// Should still work for common branches
			expect(isBaseBranch("main", workspacePath)).toBe(true)
			// But return false for non-common branches
			expect(isBaseBranch("canary", workspacePath)).toBe(false)
		})

		it("should try to set remote HEAD if symbolic-ref fails initially", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (callCount === 1) {
					// First call to symbolic-ref fails
					throw new Error("No symbolic ref")
				} else if (callCount === 2) {
					// Second call to set-head succeeds
					return ""
				} else if (callCount === 3) {
					// Third call to symbolic-ref succeeds
					return "refs/remotes/origin/canary\n"
				}
				return ""
			})

			const result = isBaseBranch("canary", workspacePath)

			expect(result).toBe(true)
			expect(execSync).toHaveBeenCalledTimes(3)
		})
	})
})

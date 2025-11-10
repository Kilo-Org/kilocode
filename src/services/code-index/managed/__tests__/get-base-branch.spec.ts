/**
 * Tests for getBaseBranch and getDefaultBranchFromRemote functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { execSync } from "child_process"
import { getBaseBranch, getDefaultBranchFromRemote } from "../git-utils"

// Mock child_process
vi.mock("child_process", () => ({
	execSync: vi.fn(),
}))

describe("Git Base Branch Detection", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getDefaultBranchFromRemote", () => {
		it("should return default branch from remote symbolic ref", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/main\n")

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("main")
			expect(execSync).toHaveBeenCalledWith("git symbolic-ref refs/remotes/origin/HEAD", {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})
		})

		it("should return canary when remote default is canary", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/canary\n")

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("canary")
		})

		it("should return develop when remote default is develop", () => {
			vi.mocked(execSync).mockReturnValue("refs/remotes/origin/develop\n")

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("develop")
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
					return "refs/remotes/origin/main\n"
				}
				return ""
			})

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("main")
			expect(execSync).toHaveBeenCalledTimes(3)
			expect(execSync).toHaveBeenNthCalledWith(2, "git remote set-head origin --auto", {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})
		})

		it("should return null if unable to determine remote default", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("Failed")
			})

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBeNull()
		})

		it("should return null if symbolic-ref output is malformed", () => {
			vi.mocked(execSync).mockReturnValue("invalid-format\n")

			const result = getDefaultBranchFromRemote(workspacePath)

			expect(result).toBeNull()
		})
	})

	describe("getBaseBranch", () => {
		it("should return default branch from remote when available", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (cmd.includes("symbolic-ref")) {
					return "refs/remotes/origin/canary\n"
				} else if (cmd.includes("rev-parse --verify canary")) {
					return "abc123\n"
				}
				return ""
			})

			const result = getBaseBranch(workspacePath)

			expect(result).toBe("canary")
		})

		it("should fallback to main if remote default doesn't exist locally", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (cmd.includes("symbolic-ref")) {
					return "refs/remotes/origin/canary\n"
				} else if (cmd.includes("rev-parse --verify canary")) {
					throw new Error("Branch doesn't exist locally")
				} else if (cmd.includes("rev-parse --verify main")) {
					return "abc123\n"
				}
				return ""
			})

			const result = getBaseBranch(workspacePath)

			expect(result).toBe("main")
		})

		it("should check common branches when remote default is unavailable", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (cmd.includes("symbolic-ref")) {
					throw new Error("No remote HEAD")
				} else if (cmd.includes("set-head")) {
					throw new Error("Cannot set HEAD")
				} else if (cmd.includes("rev-parse --verify main")) {
					throw new Error("main doesn't exist")
				} else if (cmd.includes("rev-parse --verify develop")) {
					return "abc123\n"
				}
				return ""
			})

			const result = getBaseBranch(workspacePath)

			expect(result).toBe("develop")
		})

		it("should return master if main and develop don't exist", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (cmd.includes("symbolic-ref") || cmd.includes("set-head")) {
					throw new Error("No remote")
				} else if (cmd.includes("rev-parse --verify main")) {
					throw new Error("main doesn't exist")
				} else if (cmd.includes("rev-parse --verify develop")) {
					throw new Error("develop doesn't exist")
				} else if (cmd.includes("rev-parse --verify master")) {
					return "abc123\n"
				}
				return ""
			})

			const result = getBaseBranch(workspacePath)

			expect(result).toBe("master")
		})

		it("should fallback to main if no branches exist", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("No branches")
			})

			const result = getBaseBranch(workspacePath)

			expect(result).toBe("main")
		})

		it("should prioritize remote default over common branch names", () => {
			let callCount = 0
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				callCount++
				if (cmd.includes("symbolic-ref")) {
					return "refs/remotes/origin/production\n"
				} else if (cmd.includes("rev-parse --verify production")) {
					return "abc123\n"
				} else if (cmd.includes("rev-parse --verify main")) {
					return "def456\n"
				}
				return ""
			})

			const result = getBaseBranch(workspacePath)

			// Should return production (from remote) even though main exists
			expect(result).toBe("production")
		})
	})
})

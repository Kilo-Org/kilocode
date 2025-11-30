// kilocode_change - new file
/**
 * Tests for getBaseBranch and getDefaultBranchFromRemote functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { getBaseBranch, getDefaultBranchFromRemote } from "../git-utils"

// Mock exec utils
vi.mock("../../../../shared/utils/exec", () => ({
	execGetLines: vi.fn(),
}))

import { execGetLines } from "../../../../shared/utils/exec"
import type { ExecOptions } from "../../../../shared/utils/exec"

describe("Git Base Branch Detection", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getDefaultBranchFromRemote", () => {
		it("should return default branch from remote symbolic ref", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/main"
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("main")
		})

		it("should return canary when remote default is canary", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/canary"
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("canary")
		})

		it("should return develop when remote default is develop", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/develop"
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("develop")
		})

		it("should try to set remote HEAD if symbolic-ref fails initially", async () => {
			let callCount = 0
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				callCount++
				if (callCount === 1) {
					// First call to symbolic-ref fails
					throw new Error("No symbolic ref")
				} else if (callCount === 2) {
					// Second call to set-head succeeds
					return
				} else if (callCount === 3) {
					// Third call to symbolic-ref succeeds
					yield "refs/remotes/origin/main"
				}
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBe("main")
			expect(execGetLines).toHaveBeenCalledTimes(3)
		})

		it("should return null if unable to determine remote default", async () => {
			// eslint-disable-next-line require-yield
			vi.mocked(execGetLines).mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("Failed")
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBeNull()
		})

		it("should return null if symbolic-ref output is malformed", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "invalid-format"
			})

			const result = await getDefaultBranchFromRemote(workspacePath)

			expect(result).toBeNull()
		})
	})

	describe("getBaseBranch", () => {
		it("should return default branch from remote when available", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				if (cmd.includes("symbolic-ref")) {
					yield "refs/remotes/origin/canary"
				} else if (cmd.includes("rev-parse --verify canary")) {
					yield "abc123"
				}
			})

			const result = await getBaseBranch(workspacePath)

			expect(result).toBe("canary")
		})

		it("should fallback to main if remote default doesn't exist locally", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				if (cmd.includes("symbolic-ref")) {
					yield "refs/remotes/origin/canary"
				} else if (cmd.includes("rev-parse --verify canary")) {
					throw new Error("Branch doesn't exist locally")
				} else if (cmd.includes("rev-parse --verify main")) {
					yield "abc123"
				}
			})

			const result = await getBaseBranch(workspacePath)

			expect(result).toBe("main")
		})

		it("should check common branches when remote default is unavailable", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				if (cmd.includes("symbolic-ref")) {
					throw new Error("No remote HEAD")
				} else if (cmd.includes("set-head")) {
					throw new Error("Cannot set HEAD")
				} else if (cmd.includes("rev-parse --verify main")) {
					throw new Error("main doesn't exist")
				} else if (cmd.includes("rev-parse --verify develop")) {
					yield "abc123"
				}
			})

			const result = await getBaseBranch(workspacePath)

			expect(result).toBe("develop")
		})

		it("should return master if main and develop don't exist", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				if (cmd.includes("symbolic-ref") || cmd.includes("set-head")) {
					throw new Error("No remote")
				} else if (cmd.includes("rev-parse --verify main")) {
					throw new Error("main doesn't exist")
				} else if (cmd.includes("rev-parse --verify develop")) {
					throw new Error("develop doesn't exist")
				} else if (cmd.includes("rev-parse --verify master")) {
					yield "abc123"
				}
			})

			const result = await getBaseBranch(workspacePath)

			expect(result).toBe("master")
		})

		it("should fallback to main if no branches exist", async () => {
			// eslint-disable-next-line require-yield
			vi.mocked(execGetLines).mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("No branches")
			})

			const result = await getBaseBranch(workspacePath)

			expect(result).toBe("main")
		})

		it("should prioritize remote default over common branch names", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* ({ cmd }: ExecOptions) {
				if (cmd.includes("symbolic-ref")) {
					yield "refs/remotes/origin/production"
				} else if (cmd.includes("rev-parse --verify production")) {
					yield "abc123"
				} else if (cmd.includes("rev-parse --verify main")) {
					yield "def456"
				}
			})

			const result = await getBaseBranch(workspacePath)

			// Should return production (from remote) even though main exists
			expect(result).toBe("production")
		})
	})
})

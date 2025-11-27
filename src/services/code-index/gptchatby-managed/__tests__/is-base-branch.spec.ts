// kilocode_change - new file
/**
 * Tests for isBaseBranch functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { isBaseBranch } from "../git-utils"

// Mock exec utils
vi.mock("../../../../shared/utils/exec", () => ({
	execGetLines: vi.fn(),
}))

import { execGetLines } from "../../../../shared/utils/exec"
import type { ExecOptions } from "../../../../shared/utils/exec"

describe("isBaseBranch", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("without workspace path", () => {
		it("should return true for main", async () => {
			expect(await isBaseBranch("main")).toBe(true)
		})

		it("should return true for master", async () => {
			expect(await isBaseBranch("master")).toBe(true)
		})

		it("should return true for develop", async () => {
			expect(await isBaseBranch("develop")).toBe(true)
		})

		it("should return true for development", async () => {
			expect(await isBaseBranch("development")).toBe(true)
		})

		it("should be case insensitive for common branches", async () => {
			expect(await isBaseBranch("MAIN")).toBe(true)
			expect(await isBaseBranch("Master")).toBe(true)
			expect(await isBaseBranch("DEVELOP")).toBe(true)
		})

		it("should return false for feature branches", async () => {
			expect(await isBaseBranch("feature/new-api")).toBe(false)
			expect(await isBaseBranch("bugfix/issue-123")).toBe(false)
			expect(await isBaseBranch("canary")).toBe(false)
		})
	})

	describe("with workspace path", () => {
		it("should return true for common base branches even without checking remote", async () => {
			expect(await isBaseBranch("main", workspacePath)).toBe(true)
			expect(await isBaseBranch("master", workspacePath)).toBe(true)
			expect(await isBaseBranch("develop", workspacePath)).toBe(true)
		})

		it("should return true when branch matches remote default", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/canary"
			})

			const result = await isBaseBranch("canary", workspacePath)

			expect(result).toBe(true)
		})

		it("should be case insensitive when comparing with remote default", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/Canary"
			})

			expect(await isBaseBranch("canary", workspacePath)).toBe(true)
			expect(await isBaseBranch("CANARY", workspacePath)).toBe(true)
			expect(await isBaseBranch("Canary", workspacePath)).toBe(true)
		})

		it("should return true for production when it's the remote default", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/production"
			})

			expect(await isBaseBranch("production", workspacePath)).toBe(true)
		})

		it("should return false when branch doesn't match remote default", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "refs/remotes/origin/main"
			})

			expect(await isBaseBranch("feature/test", workspacePath)).toBe(false)
		})

		it("should return false when remote default cannot be determined", async () => {
			// eslint-disable-next-line require-yield
			vi.mocked(execGetLines).mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("No remote")
			})

			expect(await isBaseBranch("canary", workspacePath)).toBe(false)
		})

		it("should handle remote default check failure gracefully", async () => {
			// eslint-disable-next-line require-yield
			vi.mocked(execGetLines).mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("Git error")
			})

			// Should still work for common branches
			expect(await isBaseBranch("main", workspacePath)).toBe(true)
			// But return false for non-common branches
			expect(await isBaseBranch("canary", workspacePath)).toBe(false)
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
					yield "refs/remotes/origin/canary"
				}
			})

			const result = await isBaseBranch("canary", workspacePath)

			expect(result).toBe(true)
			expect(execGetLines).toHaveBeenCalledTimes(3)
		})
	})
})

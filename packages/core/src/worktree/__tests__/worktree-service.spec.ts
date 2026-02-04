import * as path from "path"

import { WorktreeService } from "../worktree-service.js"

describe("WorktreeService", () => {
	describe("normalizePath", () => {
		let service: WorktreeService

		beforeEach(() => {
			service = new WorktreeService()
		})

		// Access private method for testing
		const callNormalizePath = (service: WorktreeService, p: string): string => {
			// @ts-expect-error - accessing private method for testing
			return service.normalizePath(p)
		}

		it("should normalize paths with trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project/")
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should normalize paths with multiple trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project///")
			// path.normalize already handles multiple slashes
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should preserve root path /", () => {
			// This is a critical test - the old regex would turn "/" into ""
			// On Windows, path.normalize("/") returns "\", on Unix it returns "/"
			const result = callNormalizePath(service, "/")
			expect(result).toBe(path.sep)
		})

		it("should handle paths without trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project")
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should handle relative paths", () => {
			const result = callNormalizePath(service, "./some/path/")
			expect(result).toBe(path.normalize("./some/path"))
		})

		it("should handle empty string", () => {
			const result = callNormalizePath(service, "")
			expect(result).toBe(".")
		})

		it("should handle Windows-style paths on non-Windows", () => {
			// path.normalize will convert separators appropriately
			const result = callNormalizePath(service, "C:\\Users\\test\\project")
			// On Unix, this stays as-is; on Windows it would normalize
			expect(result).toBeTruthy()
		})
	})

	describe("parseWorktreeOutput", () => {
		let service: WorktreeService

		beforeEach(() => {
			service = new WorktreeService()
		})

		// Access private method for testing
		const callParseWorktreeOutput = (
			service: WorktreeService,
			output: string,
			currentCwd: string,
		): ReturnType<WorktreeService["parseWorktreeOutput"]> => {
			// @ts-expect-error - accessing private method for testing
			return service.parseWorktreeOutput(output, currentCwd)
		}

		it("should parse porcelain output correctly", () => {
			const output = `worktree /home/user/repo
HEAD abc123def456
branch refs/heads/main

worktree /home/user/repo-feature
HEAD def456abc123
branch refs/heads/feature/test
`
			const result = callParseWorktreeOutput(service, output, "/home/user/repo")

			expect(result).toHaveLength(2)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo",
				branch: "main",
				commitHash: "abc123def456",
				isCurrent: true,
			})
			expect(result[1]).toMatchObject({
				path: "/home/user/repo-feature",
				branch: "feature/test",
				commitHash: "def456abc123",
				isCurrent: false,
			})
		})

		it("should handle detached HEAD worktrees", () => {
			const output = `worktree /home/user/repo-detached
HEAD abc123def456
detached
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo-detached",
				isDetached: true,
				branch: "",
			})
		})

		it("should handle locked worktrees", () => {
			const output = `worktree /home/user/repo-locked
HEAD abc123def456
branch refs/heads/locked-branch
locked some reason here
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				isLocked: true,
				lockReason: "some reason here",
			})
		})

		it("should handle bare worktrees", () => {
			const output = `worktree /home/user/repo.git
bare
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo.git",
				isBare: true,
			})
		})
	})
})

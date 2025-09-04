import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GitExtensionService } from "../GitExtensionService"
import { spawnSync } from "child_process"

// Mock child_process module
vi.mock("child_process", () => ({
	spawnSync: vi.fn(),
}))

describe("GitExtensionService - Error Handling", () => {
	let gitService: GitExtensionService
	let consoleSpy: ReturnType<typeof vi.spyOn>
	let mockSpawnSync: ReturnType<typeof vi.mocked<typeof spawnSync>>

	beforeEach(() => {
		gitService = new GitExtensionService()
		consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		mockSpawnSync = vi.mocked(spawnSync)
	})

	afterEach(() => {
		vi.clearAllMocks()
		consoleSpy.mockRestore()
	})

	it("should log detailed error when Git command not found", () => {
		const testPath = "/test/workspace"
		const error = new Error("spawn git ENOENT")
		;(error as NodeJS.ErrnoException).code = "ENOENT"

		mockSpawnSync.mockReturnValue({
			status: null,
			signal: null,
			error: error,
			pid: 0,
			output: [],
			stdout: "",
			stderr: "",
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(false)
		expect(consoleSpy).toHaveBeenCalledWith(
			`[GitExtensionService] Git command not found when validating repository at: ${testPath}`,
		)
		expect(consoleSpy).toHaveBeenCalledWith(
			`[GitExtensionService] Please ensure Git is installed and available in PATH`,
		)
	})

	it("should log detailed error when permission denied", () => {
		const testPath = "/test/workspace"
		const error = new Error("Permission denied")
		;(error as NodeJS.ErrnoException).code = "EACCES"

		mockSpawnSync.mockReturnValue({
			status: null,
			signal: null,
			error: error,
			pid: 0,
			output: [],
			stdout: "",
			stderr: "",
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(false)
		expect(consoleSpy).toHaveBeenCalledWith(
			`[GitExtensionService] Permission denied when accessing Git repository at: ${testPath}`,
		)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Error details:`, "Permission denied")
	})

	it("should log detailed error when not a Git repository", () => {
		const testPath = "/test/workspace"

		mockSpawnSync.mockReturnValue({
			status: 128,
			signal: null,
			error: undefined,
			pid: 0,
			output: [],
			stdout: "",
			stderr: "fatal: not a git repository (or any of the parent directories): .git",
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(false)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Path is not a Git repository: ${testPath}`)
	})

	it("should log detailed error when Git repository is corrupted", () => {
		const testPath = "/test/workspace"

		mockSpawnSync.mockReturnValue({
			status: 128,
			signal: null,
			error: undefined,
			pid: 0,
			output: [],
			stdout: "",
			stderr: "fatal: bad revision 'HEAD'",
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(false)
		expect(consoleSpy).toHaveBeenCalledWith(
			`[GitExtensionService] Corrupted Git repository detected at: ${testPath}`,
		)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Git error: fatal: bad revision 'HEAD'`)
	})

	it("should log unexpected errors with stack trace", () => {
		const testPath = "/test/workspace"
		const error = new Error("Unexpected error")
		error.stack = "Error: Unexpected error\n    at test"

		mockSpawnSync.mockImplementation(() => {
			throw error
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(false)
		expect(consoleSpy).toHaveBeenCalledWith(
			`[GitExtensionService] Unexpected error during Git repository validation for: ${testPath}`,
		)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Error type: Error`)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Error message: Unexpected error`)
		expect(consoleSpy).toHaveBeenCalledWith(`[GitExtensionService] Stack trace:`, error.stack)
	})

	it("should return true and not log errors for valid Git repository", () => {
		const testPath = "/test/workspace"

		mockSpawnSync.mockReturnValue({
			status: 0,
			signal: null,
			error: undefined,
			pid: 0,
			output: [],
			stdout: ".git",
			stderr: "",
		})

		const result = gitService["isValidGitRepository"](testPath)

		expect(result).toBe(true)
		expect(consoleSpy).not.toHaveBeenCalled()
	})
})

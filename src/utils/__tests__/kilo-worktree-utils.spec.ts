import { sanitizeName, createWorktree } from "../kilo-worktree-utils"
import * as vscode from "vscode"
import simpleGit from "simple-git"
import { promises as fs } from "fs"
import * as path from "path"
import os from "os"

describe("sanitizeName", () => {
	it("should keep alphanumeric characters and dashes", () => {
		expect(sanitizeName("my-branch-123")).toBe("my-branch-123")
	})

	it("should replace spaces with dashes", () => {
		expect(sanitizeName("my branch name")).toBe("my-branch-name")
	})

	it("should replace special characters with dashes", () => {
		expect(sanitizeName("feature/new-feature")).toBe("feature-new-feature")
		expect(sanitizeName("fix@bug#123")).toBe("fix-bug-123")
		expect(sanitizeName("test_underscore")).toBe("test-underscore")
	})

	it("should replace multiple consecutive dashes with a single dash", () => {
		expect(sanitizeName("my---branch")).toBe("my-branch")
		expect(sanitizeName("test--name")).toBe("test-name")
		expect(sanitizeName("a----b")).toBe("a-b")
	})

	it("should remove leading dashes", () => {
		expect(sanitizeName("-my-branch")).toBe("my-branch")
		expect(sanitizeName("---test")).toBe("test")
	})

	it("should remove trailing dashes", () => {
		expect(sanitizeName("my-branch-")).toBe("my-branch")
		expect(sanitizeName("test---")).toBe("test")
	})

	it("should remove both leading and trailing dashes", () => {
		expect(sanitizeName("-my-branch-")).toBe("my-branch")
		expect(sanitizeName("---test---")).toBe("test")
	})

	it("should limit output to 50 characters", () => {
		const longName = "a".repeat(100)
		expect(sanitizeName(longName)).toBe("a".repeat(50))
	})

	it("should handle mixed special characters and limit to 50 chars", () => {
		const longName = "feature/very-long-branch-name-with-special@characters#and$symbols%that^exceeds&the*limit"
		const result = sanitizeName(longName)
		expect(result.length).toBeLessThanOrEqual(50)
		expect(result).toBe("feature-very-long-branch-name-with-special-charact")
	})

	it("should handle empty string by returning a UUID", () => {
		const result = sanitizeName("")
		// Should return a valid UUID format
		expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
	})

	it("should handle string with only special characters by returning a UUID", () => {
		const result = sanitizeName("@#$%^&*()")
		// Should return a valid UUID format
		expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
	})

	it("should handle string with only dashes by returning a UUID", () => {
		const result = sanitizeName("-----")
		// Should return a valid UUID format
		expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
	})

	it("should preserve uppercase letters", () => {
		expect(sanitizeName("MyBranchName")).toBe("MyBranchName")
		expect(sanitizeName("UPPERCASE-branch")).toBe("UPPERCASE-branch")
	})

	it("should handle unicode characters by replacing them with dashes", () => {
		expect(sanitizeName("branch-名前")).toBe("branch")
		expect(sanitizeName("test-émoji-🚀")).toBe("test-moji")
	})

	it("should handle real-world branch name examples", () => {
		expect(sanitizeName("feature/add-new-component")).toBe("feature-add-new-component")
		expect(sanitizeName("bugfix/issue-#123")).toBe("bugfix-issue-123")
		expect(sanitizeName("hotfix/critical bug fix")).toBe("hotfix-critical-bug-fix")
		expect(sanitizeName("release/v1.2.3")).toBe("release-v1-2-3")
	})

	it("should handle edge case with special chars at boundaries after replacement", () => {
		expect(sanitizeName("@test@")).toBe("test")
		expect(sanitizeName("#branch#")).toBe("branch")
		expect(sanitizeName("/start/end/")).toBe("start-end")
	})

	it("should handle mixed case with numbers", () => {
		expect(sanitizeName("Feature123Test456")).toBe("Feature123Test456")
		expect(sanitizeName("v1.2.3-beta")).toBe("v1-2-3-beta")
	})

	it("should truncate at 50 chars and remove trailing dash if created by truncation", () => {
		// Create a string that when truncated at 50 would end with a dash
		const name = "a".repeat(49) + "-" + "b".repeat(10)
		const result = sanitizeName(name)
		expect(result.length).toBeLessThanOrEqual(50)
		expect(result).not.toMatch(/-$/)
	})
})

// Mock modules
vi.mock("simple-git")
vi.mock("vscode")
vi.mock("fs", () => ({
	promises: {
		mkdir: vi.fn(),
		access: vi.fn(),
	},
}))

describe("createWorktree", () => {
	const mockWorkspaceRoot = "/mock/workspace"
	const mockHomeDir = "/mock/home"
	const mockBranchName = "test-branch"

	let mockGit: any
	let mockUri: vscode.Uri

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock Date.now() to return a consistent timestamp
		vi.spyOn(Date, "now").mockReturnValue(1234567890)

		// Mock os.homedir()
		vi.spyOn(os, "homedir").mockReturnValue(mockHomeDir)

		// Setup mock git instance
		mockGit = {
			checkIsRepo: vi.fn().mockResolvedValue(true),
			branchLocal: vi.fn().mockResolvedValue({ all: [] }),
			raw: vi.fn().mockResolvedValue(""),
		}

		vi.mocked(simpleGit).mockReturnValue(mockGit as any)

		// Setup mock vscode.Uri
		mockUri = {
			fsPath: mockWorkspaceRoot,
		} as vscode.Uri

		// Mock fs.mkdir to succeed
		vi.mocked(fs.mkdir).mockResolvedValue(undefined)

		// Mock fs.access to throw ENOENT (directory doesn't exist)
		const enoentError: any = new Error("ENOENT")
		enoentError.code = "ENOENT"
		vi.mocked(fs.access).mockRejectedValue(enoentError)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("with provided workspace URI", () => {
		it("should create a worktree with sanitized branch name and timestamp", async () => {
			const result = await createWorktree(mockBranchName, mockUri)

			expect(result.branchName).toBe("test-branch-1234567890")
			expect(result.directoryPath).toBe(
				path.join(mockHomeDir, ".kilocode", "worktrees", "test-branch-1234567890"),
			)

			expect(simpleGit).toHaveBeenCalledWith(mockWorkspaceRoot)
			expect(mockGit.checkIsRepo).toHaveBeenCalled()
			expect(mockGit.branchLocal).toHaveBeenCalled()
			expect(mockGit.raw).toHaveBeenCalledWith([
				"worktree",
				"add",
				"-b",
				"test-branch-1234567890",
				path.join(mockHomeDir, ".kilocode", "worktrees", "test-branch-1234567890"),
			])
		})

		it("should sanitize branch names with special characters", async () => {
			const result = await createWorktree("feature/new-feature", mockUri)

			expect(result.branchName).toBe("feature-new-feature-1234567890")
			expect(mockGit.raw).toHaveBeenCalledWith([
				"worktree",
				"add",
				"-b",
				"feature-new-feature-1234567890",
				expect.any(String),
			])
		})

		it("should create the worktrees base directory", async () => {
			await createWorktree(mockBranchName, mockUri)

			expect(fs.mkdir).toHaveBeenCalledWith(path.join(mockHomeDir, ".kilocode", "worktrees"), { recursive: true })
		})

		it("should throw error if not a git repository", async () => {
			mockGit.checkIsRepo.mockResolvedValue(false)

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow(
				"Current workspace is not a git repository",
			)

			expect(mockGit.raw).not.toHaveBeenCalled()
		})

		it("should throw error if branch already exists", async () => {
			mockGit.branchLocal.mockResolvedValue({
				all: ["test-branch-1234567890", "other-branch"],
			})

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow(
				"Branch 'test-branch-1234567890' already exists",
			)

			expect(mockGit.raw).not.toHaveBeenCalled()
		})

		it("should throw error if directory already exists", async () => {
			vi.mocked(fs.access).mockResolvedValue(undefined)

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow(
				"Directory '/mock/home/.kilocode/worktrees/test-branch-1234567890' already exists",
			)

			expect(mockGit.raw).not.toHaveBeenCalled()
		})

		it("should throw error if git worktree command fails", async () => {
			mockGit.raw.mockRejectedValue(new Error("Git command failed"))

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow(
				"Failed to create worktree: Git command failed",
			)
		})

		it("should handle non-Error objects from git command failure", async () => {
			mockGit.raw.mockRejectedValue("String error")

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow(
				"Failed to create worktree: String error",
			)
		})

		it("should rethrow fs.access errors that are not ENOENT", async () => {
			const otherError: any = new Error("Permission denied")
			otherError.code = "EACCES"
			vi.mocked(fs.access).mockRejectedValue(otherError)

			await expect(createWorktree(mockBranchName, mockUri)).rejects.toThrow("Permission denied")
		})
	})

	describe("without provided workspace URI", () => {
		beforeEach(() => {
			// Reset vscode mocks
			vi.mocked(vscode.window).activeTextEditor = undefined as any
			vi.mocked(vscode.workspace).workspaceFolders = undefined as any
			vi.spyOn(vscode.workspace, "getWorkspaceFolder").mockReturnValue(undefined)
		})

		it("should use active editor's workspace folder", async () => {
			const mockDocument = { uri: { fsPath: "/editor/file.ts" } } as any
			const mockEditor = { document: mockDocument } as any
			const mockWorkspaceFolder = { uri: mockUri } as any

			vi.mocked(vscode.window).activeTextEditor = mockEditor
			vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue(mockWorkspaceFolder)

			const result = await createWorktree(mockBranchName)

			expect(vscode.workspace.getWorkspaceFolder).toHaveBeenCalledWith(mockDocument.uri)
			expect(simpleGit).toHaveBeenCalledWith(mockWorkspaceRoot)
			expect(result.branchName).toBe("test-branch-1234567890")
		})

		it("should fall back to first workspace folder if active editor has no workspace", async () => {
			const mockDocument = { uri: { fsPath: "/editor/file.ts" } } as any
			const mockEditor = { document: mockDocument } as any
			const mockWorkspaceFolders = [{ uri: mockUri }] as any

			vi.mocked(vscode.window).activeTextEditor = mockEditor
			vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue(undefined)
			vi.mocked(vscode.workspace).workspaceFolders = mockWorkspaceFolders

			const result = await createWorktree(mockBranchName)

			expect(simpleGit).toHaveBeenCalledWith(mockWorkspaceRoot)
			expect(result.branchName).toBe("test-branch-1234567890")
		})

		it("should use first workspace folder if no active editor", async () => {
			const mockWorkspaceFolders = [{ uri: mockUri }] as any

			vi.mocked(vscode.window).activeTextEditor = undefined
			vi.mocked(vscode.workspace).workspaceFolders = mockWorkspaceFolders

			const result = await createWorktree(mockBranchName)

			expect(simpleGit).toHaveBeenCalledWith(mockWorkspaceRoot)
			expect(result.branchName).toBe("test-branch-1234567890")
		})

		it("should throw error if no workspace folders exist (with active editor)", async () => {
			const mockDocument = { uri: { fsPath: "/editor/file.ts" } } as any
			const mockEditor = { document: mockDocument } as any

			vi.mocked(vscode.window).activeTextEditor = mockEditor
			vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue(undefined)
			vi.mocked(vscode.workspace).workspaceFolders = undefined

			await expect(createWorktree(mockBranchName)).rejects.toThrow("No workspace folder found")
		})

		it("should throw error if no workspace folders exist (without active editor)", async () => {
			vi.mocked(vscode.window).activeTextEditor = undefined
			vi.mocked(vscode.workspace).workspaceFolders = undefined

			await expect(createWorktree(mockBranchName)).rejects.toThrow("No workspace folder found")
		})

		it("should throw error if workspace folders array is empty", async () => {
			vi.mocked(vscode.window).activeTextEditor = undefined
			vi.mocked(vscode.workspace).workspaceFolders = []

			await expect(createWorktree(mockBranchName)).rejects.toThrow("No workspace folder found")
		})
	})

	describe("edge cases", () => {
		it("should handle very long branch names", async () => {
			const longName = "a".repeat(100)
			const result = await createWorktree(longName, mockUri)

			// Should be truncated to 50 chars + timestamp
			expect(result.branchName).toBe("a".repeat(50) + "-1234567890")
		})

		it("should handle branch names that result in empty string after sanitization", async () => {
			// Mock crypto.randomUUID for this test
			const mockUUID = "12345678-1234-1234-1234-123456789abc"
			vi.spyOn(crypto, "randomUUID").mockReturnValue(mockUUID)

			const result = await createWorktree("@#$%^&*()", mockUri)

			// Should use UUID + timestamp
			expect(result.branchName).toBe(`${mockUUID}-1234567890`)
		})

		it("should handle multiple worktrees created in quick succession", async () => {
			// First call with timestamp 1234567890
			const result1 = await createWorktree(mockBranchName, mockUri)
			expect(result1.branchName).toBe("test-branch-1234567890")

			// Second call with different timestamp
			vi.spyOn(Date, "now").mockReturnValue(1234567891)
			const result2 = await createWorktree(mockBranchName, mockUri)
			expect(result2.branchName).toBe("test-branch-1234567891")

			// Branch names should be different
			expect(result1.branchName).not.toBe(result2.branchName)
		})
	})
})

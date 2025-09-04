// kilocode_change - new file
// npx vitest services/commit-message/__tests__/GitExtensionService.spec.ts
import { spawnSync } from "child_process"
import * as path from "path"
import type { Mock } from "vitest"
import { GitExtensionService } from "../GitExtensionService"

vi.mock("child_process", () => ({
	spawnSync: vi.fn(),
}))

const mockWorkspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
const mockGitRepositories = [
	{
		rootUri: { fsPath: "/test/workspace" },
		inputBox: { value: "" },
	},
]

vi.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return mockWorkspaceFolders
		},
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	extensions: {
		getExtension: vi.fn(() => ({
			isActive: true,
			exports: {
				getAPI: vi.fn(() => ({
					repositories: mockGitRepositories,
				})),
			},
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
	},
	window: { showInformationMessage: vi.fn() },
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
}))

const mockSpawnSync = spawnSync as Mock

describe("GitExtensionService", () => {
	let service: GitExtensionService

	beforeEach(() => {
		service = new GitExtensionService()
		service.configureRepositoryContext()
		mockSpawnSync.mockClear()
	})

	describe("getDiffForChanges", () => {
		it("should generate diffs per file and exclude files properly for staged changes", async () => {
			const stagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
			const mockFileListOutput = stagedFiles.join("\n")

			const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
			const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: testTsDiff, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: utilsTsDiff, stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				1,
				"git",
				["diff", "--name-only", "--cached"],
				expect.any(Object),
			)

			// Should call git diff for non-excluded files only
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				2,
				"git",
				["diff", "--cached", "--", "src/test.ts"],
				expect.any(Object),
			)
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				3,
				"git",
				["diff", "--cached", "--", "src/utils.ts"],
				expect.any(Object),
			)

			// Should NOT call git diff for package-lock.json (excluded file)
			expect(mockSpawnSync).not.toHaveBeenCalledWith(
				"git",
				["diff", "--cached", "--", "package-lock.json"],
				expect.any(Object),
			)

			// Should return aggregated diffs
			expect(result).toBe(`${testTsDiff}\n${utilsTsDiff}`)
		})

		it("should return empty string when no staged files", async () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			expect(result).toBe("")
			expect(mockSpawnSync).toHaveBeenCalledTimes(1)
		})

		it("should handle file paths with special characters", async () => {
			const stagedFiles = ["src/file with spaces.ts", "src/file'with'quotes.ts"]
			const mockFileListOutput = stagedFiles.join("\n")
			const spaceDiff = "diff --git a/src/file with spaces.ts b/src/file with spaces.ts\n+content"
			const quoteDiff = "diff --git a/src/file'with'quotes.ts b/src/file'with'quotes.ts\n+content"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: spaceDiff, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: quoteDiff, stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			// Should handle file paths with special characters without manual escaping
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				2,
				"git",
				["diff", "--cached", "--", "src/file with spaces.ts"],
				expect.any(Object),
			)
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				3,
				"git",
				["diff", "--cached", "--", "src/file'with'quotes.ts"],
				expect.any(Object),
			)

			expect(result).toBe(`${spaceDiff}\n${quoteDiff}`)
		})
	})

	describe("gatherChanges", () => {
		it("should gather unstaged changes correctly", async () => {
			const mockStatusOutput = "M\tfile1.ts\nA\tfile2.ts\nD\tfile3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["diff", "--name-status"], expect.any(Object))

			expect(result).toEqual([
				{ filePath: path.join("/test/workspace/file1.ts"), status: "Modified" },
				{ filePath: path.join("/test/workspace/file2.ts"), status: "Added" },
				{ filePath: path.join("/test/workspace/file3.ts"), status: "Deleted" },
			])
		})

		it("should gather staged changes correctly", async () => {
			const mockStatusOutput = "M\tfile1.ts\nA\tfile2.ts\nD\tfile3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: true })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["diff", "--name-status", "--cached"], expect.any(Object))

			expect(result).toEqual([
				{ filePath: path.join("/test/workspace/file1.ts"), status: "Modified" },
				{ filePath: path.join("/test/workspace/file2.ts"), status: "Added" },
				{ filePath: path.join("/test/workspace/file3.ts"), status: "Deleted" },
			])
		})

		it("should return empty array when no changes", async () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})

		it("should return empty array when git command fails", async () => {
			mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "error", error: new Error("Git error") })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})
	})

	it("should generate diffs per file and exclude files properly for unstaged changes", async () => {
		const unstagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
		const mockFileListOutput = unstagedFiles.join("\n")

		const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
		const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

		mockSpawnSync
			.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: testTsDiff, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: utilsTsDiff, stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		const result = await getDiffForChanges.call(service, { staged: false })

		expect(mockSpawnSync).toHaveBeenNthCalledWith(1, "git", ["diff", "--name-only"], expect.any(Object))

		expect(mockSpawnSync).toHaveBeenNthCalledWith(2, "git", ["diff", "--", "src/test.ts"], expect.any(Object))
		expect(mockSpawnSync).toHaveBeenNthCalledWith(3, "git", ["diff", "--", "src/utils.ts"], expect.any(Object))

		expect(mockSpawnSync).not.toHaveBeenCalledWith("git", ["diff", "--", "package-lock.json"], expect.any(Object))

		expect(result).toBe(`${testTsDiff}\n${utilsTsDiff}`)
	})

	it("should return empty string when no unstaged files", async () => {
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		const result = await getDiffForChanges.call(service, { staged: false })

		expect(result).toBe("")
		expect(mockSpawnSync).toHaveBeenCalledTimes(1)
	})

	describe("getCommitContext", () => {
		it("should generate context for staged changes by default", async () => {
			const mockChanges = [{ filePath: "file1.ts", status: "Modified" }]

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: "file1.ts", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "diff content", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "1 file changed", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "main", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "abc123 commit", stderr: "", error: null })

			const result = await service.getCommitContext(mockChanges, { staged: true })

			expect(result).toContain("Full Diff of Staged Changes")
			expect(result).not.toContain("Full Diff of Unstaged Changes")
		})

		it("should generate context for unstaged changes when specified", async () => {
			const mockChanges = [{ filePath: "file1.ts", status: "Modified" }]

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: "file1.ts", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "diff content", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "1 file changed", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "main", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "abc123 commit", stderr: "", error: null })

			const result = await service.getCommitContext(mockChanges, { staged: false })

			expect(result).toContain("Full Diff of Unstaged Changes")
			expect(result).not.toContain("Full Diff of Staged Changes")
		})
	})

	describe("Repository Determination Methods", () => {
		describe("getVSCodeGitRepository", () => {
			it("should return first repository when no resourceUri provided", () => {
				const getVSCodeGitRepository = (service as any).getVSCodeGitRepository
				const result = getVSCodeGitRepository.call(service)

				expect(result).toEqual({
					rootUri: { fsPath: "/test/workspace" },
					inputBox: { value: "" },
				})
			})

			it("should find matching repository by resourceUri", () => {
				// Add another repository to test matching logic
				mockGitRepositories.push({
					rootUri: { fsPath: "/test/other-workspace" },
					inputBox: { value: "" },
				})

				const resourceUri = { fsPath: "/test/other-workspace/subfolder" }
				const getVSCodeGitRepository = (service as any).getVSCodeGitRepository
				const result = getVSCodeGitRepository.call(service, resourceUri)

				expect(result).toEqual({
					rootUri: { fsPath: "/test/other-workspace" },
					inputBox: { value: "" },
				})

				// Clean up
				mockGitRepositories.pop()
			})

			it("should return null when Git extension is not active", async () => {
				const vscode = vi.mocked(await import("vscode"))
				vscode.extensions.getExtension = vi.fn(() => ({
					isActive: false,
					exports: null,
				})) as any

				const getVSCodeGitRepository = (service as any).getVSCodeGitRepository
				const result = getVSCodeGitRepository.call(service)

				expect(result).toBeNull()
			})

			it("should return null when no repositories available", async () => {
				const vscode = vi.mocked(await import("vscode"))
				vscode.extensions.getExtension = vi.fn(() => ({
					isActive: true,
					exports: {
						getAPI: vi.fn(() => ({
							repositories: [],
						})),
					},
				})) as any

				const getVSCodeGitRepository = (service as any).getVSCodeGitRepository
				const result = getVSCodeGitRepository.call(service)

				expect(result).toBeNull()
			})
		})

		describe("isExternalWorkspace", () => {
			it("should return false when resourceUri is within workspace folder", () => {
				const resourceUri = { fsPath: "/test/workspace/subfolder/file.ts" }
				const isExternalWorkspace = (service as any).isExternalWorkspace
				const result = isExternalWorkspace.call(service, resourceUri)

				expect(result).toBe(false)
			})

			it("should return true when resourceUri is outside workspace folders", () => {
				const resourceUri = { fsPath: "/external/project/file.ts" }
				const isExternalWorkspace = (service as any).isExternalWorkspace
				const result = isExternalWorkspace.call(service, resourceUri)

				expect(result).toBe(true)
			})

			it("should return true when no workspace folders exist", () => {
				// Temporarily clear workspace folders
				const originalFolders = mockWorkspaceFolders.slice()
				mockWorkspaceFolders.length = 0

				const resourceUri = { fsPath: "/any/path" }
				const isExternalWorkspace = (service as any).isExternalWorkspace
				const result = isExternalWorkspace.call(service, resourceUri)

				expect(result).toBe(true)

				// Restore workspace folders
				mockWorkspaceFolders.push(...originalFolders)
			})
		})

		describe("createExternalRepository", () => {
			beforeEach(() => {
				// Mock successful Git repository validation
				mockSpawnSync.mockReturnValue({ status: 0, stdout: ".git", stderr: "", error: null })
			})

			it("should create external repository for valid Git path", () => {
				const resourceUri = { fsPath: "/external/project" }
				const createExternalRepository = (service as any).createExternalRepository
				const result = createExternalRepository.call(service, resourceUri)

				expect(mockSpawnSync).toHaveBeenCalledWith(
					"git",
					["rev-parse", "--git-dir"],
					expect.objectContaining({
						cwd: "/external/project",
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					}),
				)

				expect(result).toEqual({
					inputBox: { value: "" },
					rootUri: { fsPath: "/external/project" },
				})
			})

			it("should return null for invalid Git repository", () => {
				// Mock failed Git repository validation
				mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "not a git repo", error: null })

				const resourceUri = { fsPath: "/invalid/path" }
				const createExternalRepository = (service as any).createExternalRepository
				const result = createExternalRepository.call(service, resourceUri)

				expect(result).toBeNull()
			})

			it("should handle Git command errors gracefully", () => {
				// Mock Git command error
				mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "", error: new Error("Git not found") })

				const resourceUri = { fsPath: "/error/path" }
				const createExternalRepository = (service as any).createExternalRepository
				const result = createExternalRepository.call(service, resourceUri)

				expect(result).toBeNull()
			})
		})

		describe("determineTargetRepository", () => {
			beforeEach(async () => {
				// Reset Git extension mock to default state
				const vscode = vi.mocked(await import("vscode"))
				vscode.extensions.getExtension = vi.fn(() => ({
					isActive: true,
					exports: {
						getAPI: vi.fn(() => ({
							repositories: mockGitRepositories,
						})),
					},
				})) as any
			})

			it("should return VSCode repository when no resourceUri provided", () => {
				const determineTargetRepository = (service as any).determineTargetRepository
				const result = determineTargetRepository.call(service)

				expect(result).toEqual({
					rootUri: { fsPath: "/test/workspace" },
					inputBox: { value: "" },
				})
			})

			it("should create external repository for external workspace", () => {
				// Mock successful Git validation for external path
				mockSpawnSync.mockReturnValue({ status: 0, stdout: ".git", stderr: "", error: null })

				const resourceUri = { fsPath: "/external/project" }
				const determineTargetRepository = (service as any).determineTargetRepository
				const result = determineTargetRepository.call(service, resourceUri)

				expect(result).toEqual({
					inputBox: { value: "" },
					rootUri: { fsPath: "/external/project" },
				})
			})

			it("should find matching VSCode repository for internal workspace", () => {
				const resourceUri = { fsPath: "/test/workspace/subfolder" }
				const determineTargetRepository = (service as any).determineTargetRepository
				const result = determineTargetRepository.call(service, resourceUri)

				expect(result).toEqual({
					rootUri: { fsPath: "/test/workspace" },
					inputBox: { value: "" },
				})
			})

			it("should return null when all methods fail", async () => {
				// Mock Git extension unavailable
				const vscode = vi.mocked(await import("vscode"))
				vscode.extensions.getExtension = vi.fn(() => null) as any

				// Mock invalid Git repository
				mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "not a git repo", error: null })

				const resourceUri = { fsPath: "/invalid/path" }
				const determineTargetRepository = (service as any).determineTargetRepository
				const result = determineTargetRepository.call(service, resourceUri)

				expect(result).toBeNull()
			})

			it("should handle errors gracefully and return null", async () => {
				// Force an error in the method
				const vscode = vi.mocked(await import("vscode"))
				vscode.extensions.getExtension = vi.fn(() => {
					throw new Error("Extension error")
				}) as any

				const determineTargetRepository = (service as any).determineTargetRepository
				const result = determineTargetRepository.call(service)

				expect(result).toBeNull()
			})
		})
	})
})

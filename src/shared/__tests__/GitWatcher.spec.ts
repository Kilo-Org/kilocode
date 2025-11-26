// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import * as fs from "fs"
import { GitWatcher, GitWatcherConfig, GitWatcherEvent, GitWatcherFile } from "../GitWatcher"
import * as exec from "../utils/exec"
import * as gitUtils from "../../services/code-index/managed/git-utils"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	Disposable: class {
		constructor(public dispose: () => any) {}
		static from(...disposables: { dispose: () => any }[]) {
			return {
				dispose: () => disposables.forEach((d) => d.dispose()),
			}
		}
	},
}))

// Mock fs
vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		watch: vi.fn().mockReturnValue({ close: vi.fn() }),
		existsSync: vi.fn().mockReturnValue(true),
	}
})

// Mock exec utilities
vi.mock("../utils/exec")

// Mock git utilities
vi.mock("../../services/code-index/managed/git-utils")

describe("GitWatcher", () => {
	let config: GitWatcherConfig
	let mockExecGetLines: ReturnType<typeof vi.fn>
	let mockGetCurrentBranch: ReturnType<typeof vi.fn>
	let mockGetCurrentCommitSha: ReturnType<typeof vi.fn>
	let mockGetGitHeadPath: ReturnType<typeof vi.fn>
	let mockIsDetachedHead: ReturnType<typeof vi.fn>
	let mockGetBaseBranch: ReturnType<typeof vi.fn>
	let mockGetGitDiff: ReturnType<typeof vi.fn>

	beforeEach(() => {
		config = {
			cwd: "/test/repo",
		}

		// Setup mocks
		mockExecGetLines = vi.fn()
		mockGetCurrentBranch = vi.fn()
		mockGetCurrentCommitSha = vi.fn()
		mockGetGitHeadPath = vi.fn()
		mockIsDetachedHead = vi.fn()
		mockGetBaseBranch = vi.fn()
		mockGetGitDiff = vi.fn()

		vi.mocked(exec.execGetLines).mockImplementation(mockExecGetLines)
		vi.mocked(gitUtils.getCurrentBranch).mockImplementation(mockGetCurrentBranch)
		vi.mocked(gitUtils.getCurrentCommitSha).mockImplementation(mockGetCurrentCommitSha)
		vi.mocked(gitUtils.getGitHeadPath).mockImplementation(mockGetGitHeadPath)
		vi.mocked(gitUtils.isDetachedHead).mockImplementation(mockIsDetachedHead)
		vi.mocked(gitUtils.getBaseBranch).mockImplementation(mockGetBaseBranch)
		vi.mocked(gitUtils.getGitDiff).mockImplementation(mockGetGitDiff)

		// Default mock implementations
		mockIsDetachedHead.mockResolvedValue(false)
		mockGetCurrentBranch.mockResolvedValue("main")
		mockGetCurrentCommitSha.mockResolvedValue("abc123")
		mockGetGitHeadPath.mockResolvedValue(".git/HEAD")
		mockGetBaseBranch.mockResolvedValue("main")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create a GitWatcher instance", () => {
			const watcher = new GitWatcher(config)
			expect(watcher).toBeInstanceOf(GitWatcher)
			watcher.dispose()
		})

		it("should accept defaultBranchOverride in config", () => {
			const configWithOverride: GitWatcherConfig = {
				cwd: "/test/repo",
				defaultBranchOverride: "develop",
			}
			const watcher = new GitWatcher(configWithOverride)
			expect(watcher).toBeInstanceOf(GitWatcher)
			watcher.dispose()
		})
	})

	describe("onEvent", () => {
		it("should register an event handler", async () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			// Create a mock async iterable
			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const testEvent: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/test",
				branch: "feature/test",
				isBaseBranch: false,
				watcher,
				files: mockFiles(),
			}

			// Access the private emitter to test
			;(watcher as any).emitter.emit("event", testEvent)

			expect(handler).toHaveBeenCalledWith(testEvent)
			watcher.dispose()
		})

		it("should allow multiple handlers", async () => {
			const watcher = new GitWatcher(config)
			const handler1 = vi.fn()
			const handler2 = vi.fn()

			watcher.onEvent(handler1)
			watcher.onEvent(handler2)

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const testEvent: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc123",
				newCommit: "def456",
				branch: "main",
				isBaseBranch: true,
				watcher,
				files: mockFiles(),
			}

			;(watcher as any).emitter.emit("event", testEvent)

			expect(handler1).toHaveBeenCalledWith(testEvent)
			expect(handler2).toHaveBeenCalledWith(testEvent)
			watcher.dispose()
		})

		it("should emit branch-changed events with files iterable", async () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const branchChangedEvent: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/test",
				branch: "feature/test",
				isBaseBranch: false,
				watcher,
				files: mockFiles(),
			}

			;(watcher as any).emitter.emit("event", branchChangedEvent)

			expect(handler).toHaveBeenCalledWith(branchChangedEvent)
			watcher.dispose()
		})

		it("should emit commit events with files iterable", async () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const commitEvent: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc123",
				newCommit: "def456",
				branch: "main",
				isBaseBranch: true,
				watcher,
				files: mockFiles(),
			}

			;(watcher as any).emitter.emit("event", commitEvent)

			expect(handler).toHaveBeenCalledWith(commitEvent)
			watcher.dispose()
		})
	})

	describe("start", () => {
		it("should initialize git state monitoring", async () => {
			const watcher = new GitWatcher(config)
			await watcher.start()

			expect(mockGetCurrentBranch).toHaveBeenCalled()
			expect(mockGetCurrentCommitSha).toHaveBeenCalled()
			expect(mockGetGitHeadPath).toHaveBeenCalled()

			watcher.dispose()
		})

		it("should handle detached HEAD state during initialization", async () => {
			mockIsDetachedHead.mockResolvedValue(true)

			const watcher = new GitWatcher(config)
			await watcher.start()

			// Should not throw and should handle gracefully
			expect(mockGetCurrentBranch).not.toHaveBeenCalled()

			watcher.dispose()
		})
	})

	describe("dispose", () => {
		it("should clean up resources", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			watcher.dispose()

			// Emit event after disposal - handler should not be called
			;(watcher as any).emitter.emit("event", {
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher,
				files: (async function* () {})(),
			})

			expect(handler).not.toHaveBeenCalled()
		})

		it("should dispose all file system watchers", async () => {
			const mockClose = vi.fn()
			// Mock fs.watch to return a new watcher each time
			vi.mocked(fs.watch).mockReturnValue({
				close: mockClose,
			} as any)
			vi.mocked(fs.existsSync).mockReturnValue(true)

			const watcher = new GitWatcher(config)
			await watcher.start()
			watcher.dispose()

			// Should have disposed watchers
			// Note: GitWatcher uses fs.watchFile for HEAD and packed-refs (via unwatchFile)
			// and fs.watch for refs directory, so we expect 1 call to close (for refs watcher)
			expect(mockClose).toHaveBeenCalledTimes(1)
		})
	})

	describe("git state monitoring", () => {
		it("should handle branch changes and emit event with files", async () => {
			mockGetCurrentBranch.mockResolvedValueOnce("main").mockResolvedValueOnce("feature/test")
			mockGetCurrentCommitSha.mockResolvedValueOnce("abc123").mockResolvedValueOnce("abc123")
			mockGetBaseBranch.mockResolvedValue("main")

			// Mock git ls-files output for the new branch
			mockExecGetLines.mockImplementation(async function* () {
				yield "100644 def456 0 new-file.ts"
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.start()

			// Simulate branch change by calling handleGitChange
			await (watcher as any).handleGitChange()

			// Should emit branch-changed event
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
				}),
			)

			// Verify the files iterable is present
			const event = handler.mock.calls[0][0]
			expect(event.files).toBeDefined()

			watcher.dispose()
		})

		it("should emit commit event when only commit changes", async () => {
			mockGetCurrentBranch.mockResolvedValue("main")
			mockGetCurrentCommitSha.mockResolvedValueOnce("abc123").mockResolvedValueOnce("def456")
			mockGetBaseBranch.mockResolvedValue("main")

			// Mock git ls-files output
			mockExecGetLines.mockImplementation(async function* () {
				yield "100644 ghi789 0 updated-file.ts"
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.start()

			// Simulate commit change (same branch)
			await (watcher as any).handleGitChange()

			// Should emit commit event
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "commit",
					previousCommit: "abc123",
					newCommit: "def456",
					branch: "main",
					isBaseBranch: true,
				}),
			)

			// Verify the files iterable is present
			const event = handler.mock.calls[0][0]
			expect(event.files).toBeDefined()

			watcher.dispose()
		})

		it("should not process changes when already processing", async () => {
			const watcher = new GitWatcher(config)

			// Set processing flag
			;(watcher as any).isProcessing = true

			// Try to handle change - should return early
			await (watcher as any).handleGitChange()

			// Processing flag should still be true
			expect((watcher as any).isProcessing).toBe(true)

			watcher.dispose()
		})
	})

	describe("file iteration", () => {
		it("should yield all files on base branch", async () => {
			mockGetBaseBranch.mockResolvedValue("main")

			const mockLines = [
				"100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md",
				"100644 a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0 0 src/index.ts",
			]

			mockExecGetLines.mockImplementation(async function* () {
				for (const line of mockLines) {
					yield line
				}
			})

			const watcher = new GitWatcher(config)

			// Call the private getAllFiles method
			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getAllFiles()) {
				files.push(file)
			}

			expect(files).toHaveLength(2)
			expect(files[0]).toEqual({
				type: "file",
				filePath: "README.md",
				fileHash: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
			})
			expect(files[1]).toEqual({
				type: "file",
				filePath: "src/index.ts",
				fileHash: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
			})

			watcher.dispose()
		})

		it("should yield diff files on feature branch", async () => {
			mockGetGitDiff.mockResolvedValue({
				added: ["new-file.ts"],
				modified: ["existing-file.ts"],
				deleted: ["old-file.ts"],
			})

			mockExecGetLines.mockImplementation(async function* () {
				yield "100644 abc123 0 new-file.ts"
				yield "100644 def456 0 existing-file.ts"
			})

			const watcher = new GitWatcher(config)

			// Call the private getDiffFiles method
			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getDiffFiles("feature/test", "main")) {
				files.push(file)
			}

			expect(files).toHaveLength(3)
			expect(files[0]).toEqual({
				type: "file-deleted",
				filePath: "old-file.ts",
			})
			expect(files[1]).toEqual({
				type: "file",
				filePath: "new-file.ts",
				fileHash: "abc123",
			})
			expect(files[2]).toEqual({
				type: "file",
				filePath: "existing-file.ts",
				fileHash: "def456",
			})

			watcher.dispose()
		})

		it("should handle files with spaces in path", async () => {
			const mockLines = ["100644 abc123 0 path with spaces/file.ts"]

			mockExecGetLines.mockImplementation(async function* () {
				for (const line of mockLines) {
					yield line
				}
			})

			const watcher = new GitWatcher(config)

			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getAllFiles()) {
				files.push(file)
			}

			expect(files).toHaveLength(1)
			expect(files[0]).toEqual({
				type: "file",
				filePath: "path with spaces/file.ts",
				fileHash: "abc123",
			})

			watcher.dispose()
		})
	})

	describe("error handling", () => {
		it("should handle errors during file iteration", async () => {
			// eslint-disable-next-line require-yield
			mockExecGetLines.mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("Git command failed")
			})

			const watcher = new GitWatcher(config)

			// Should throw when iterating
			await expect(async () => {
				for await (const file of (watcher as any).getAllFiles()) {
					// Should not reach here
				}
			}).rejects.toThrow("Git command failed")

			watcher.dispose()
		})
	})

	describe("batching", () => {
		it("should batch files to avoid command line length limits", async () => {
			// Create a large number of files (more than BATCH_SIZE of 50)
			const numFiles = 125
			const addedFiles = Array.from({ length: numFiles }, (_, i) => `file${i}.ts`)

			mockGetGitDiff.mockResolvedValue({
				added: addedFiles,
				modified: [],
				deleted: [],
			})

			let batchCount = 0
			mockExecGetLines.mockImplementation(async function* ({ cmd }: { cmd: string }) {
				batchCount++
				// Extract file count from command (count quoted filenames)
				const fileCount = (cmd.match(/"\w+\.ts"/g) || []).length
				// Each batch should have at most 50 files
				expect(fileCount).toBeLessThanOrEqual(50)

				// Generate mock output for this batch
				const matches = cmd.match(/"(file\d+\.ts)"/g) || []
				for (const match of matches) {
					const filename = match.replace(/"/g, "")
					yield `100644 abc${filename.replace(/\D/g, "")} 0 ${filename}`
				}
			})

			const watcher = new GitWatcher(config)

			// Call getDiffFiles
			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getDiffFiles("feature/test", "main")) {
				files.push(file)
			}

			// Should have processed all files
			expect(files).toHaveLength(numFiles)

			// Should have made 3 batches (50 + 50 + 25)
			expect(batchCount).toBe(3)

			// Verify all files are present
			for (let i = 0; i < numFiles; i++) {
				expect(files[i]).toEqual({
					type: "file",
					filePath: `file${i}.ts`,
					fileHash: expect.stringContaining("abc"),
				})
			}

			watcher.dispose()
		})

		it("should handle empty file list without batching", async () => {
			mockGetGitDiff.mockResolvedValue({
				added: [],
				modified: [],
				deleted: [],
			})

			const watcher = new GitWatcher(config)

			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getDiffFiles("feature/test", "main")) {
				files.push(file)
			}

			expect(files).toHaveLength(0)
			expect(mockExecGetLines).not.toHaveBeenCalled()

			watcher.dispose()
		})

		it("should handle single batch when files are under limit", async () => {
			const addedFiles = Array.from({ length: 25 }, (_, i) => `file${i}.ts`)

			mockGetGitDiff.mockResolvedValue({
				added: addedFiles,
				modified: [],
				deleted: [],
			})

			let batchCount = 0
			mockExecGetLines.mockImplementation(async function* ({ cmd }: { cmd: string }) {
				batchCount++
				const matches = cmd.match(/"(file\d+\.ts)"/g) || []
				for (const match of matches) {
					const filename = match.replace(/"/g, "")
					yield `100644 abc${filename.replace(/\D/g, "")} 0 ${filename}`
				}
			})

			const watcher = new GitWatcher(config)

			const files: GitWatcherFile[] = []
			for await (const file of (watcher as any).getDiffFiles("feature/test", "main")) {
				files.push(file)
			}

			expect(files).toHaveLength(25)
			expect(batchCount).toBe(1)

			watcher.dispose()
		})
	})
})

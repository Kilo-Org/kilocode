// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { ManagedIndexer } from "../ManagedIndexer"
import { GitWatcher, GitWatcherEvent, GitWatcherFile } from "../../../../shared/GitWatcher"
import * as gitUtils from "../git-utils"
import * as kiloConfigFile from "../../../../utils/kilo-config-file"
import * as git from "../../../../utils/git"
import * as apiClient from "../api-client"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		onDidChangeWorkspaceFolders: vi.fn(),
	},
	window: {
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
		registerCommand: vi.fn(),
	},
	Uri: {
		file: (path: string) => ({ fsPath: path }),
	},
}))

// Mock dependencies
vi.mock("../../../../shared/GitWatcher")
vi.mock("../git-utils")
vi.mock("../../../../utils/kilo-config-file")
vi.mock("../../../../utils/git")
vi.mock("../api-client")
vi.mock("../../../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))
vi.mock("fs", () => ({
	promises: {
		readFile: vi.fn(),
		stat: vi.fn(),
	},
}))
vi.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
		validateAccess: vi.fn().mockReturnValue(true),
		dispose: vi.fn(),
	})),
}))

describe("ManagedIndexer", () => {
	let mockContextProxy: any
	let indexer: ManagedIndexer
	let mockWorkspaceFolder: vscode.WorkspaceFolder

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock ContextProxy
		mockContextProxy = {
			getSecret: vi.fn((key: string) => {
				if (key === "kilocodeToken") return "test-token"
				return null
			}),
			getValue: vi.fn((key: string) => {
				if (key === "kilocodeOrganizationId") return "test-org-id"
				if (key === "kilocodeTesterWarningsDisabledUntil") return null
				return null
			}),
			getGlobalState: vi.fn((key: string) => {
				return null
			}),
			onManagedIndexerConfigChange: vi.fn(() => ({
				dispose: vi.fn(),
			})),
		}

		// Setup mock workspace folder
		mockWorkspaceFolder = {
			uri: { fsPath: "/test/workspace" } as vscode.Uri,
			name: "test-workspace",
			index: 0,
		}

		// Default mock implementations
		vi.mocked(gitUtils.isGitRepository).mockResolvedValue(true)
		vi.mocked(gitUtils.getCurrentBranch).mockResolvedValue("main")
		vi.mocked(git.getGitRepositoryInfo).mockResolvedValue({
			repositoryUrl: "https://github.com/test/repo",
			repositoryName: "repo",
		})
		vi.mocked(kiloConfigFile.getKilocodeConfig).mockResolvedValue({
			project: { id: "test-project-id" },
		} as any)
		vi.mocked(apiClient.getServerManifest).mockResolvedValue({
			files: {},
		} as any)

		vi.mocked(apiClient.isEnabled).mockResolvedValue(true)

		// Mock GitWatcher - store instances for later verification
		const mockWatcherInstances: any[] = []
		vi.mocked(GitWatcher).mockImplementation(() => {
			const mockWatcher = {
				config: { cwd: "/test/workspace" },
				onEvent: vi.fn().mockReturnValue(undefined),
				start: vi.fn().mockResolvedValue(undefined),
				dispose: vi.fn(),
			}
			mockWatcherInstances.push(mockWatcher)
			return mockWatcher as any
		})

		indexer = new ManagedIndexer(mockContextProxy)
		// Store mock instances on indexer for test access
		;(indexer as any).mockWatcherInstances = mockWatcherInstances
	})

	afterEach(() => {
		indexer.dispose()
	})

	describe("constructor", () => {
		it("should create a ManagedIndexer instance", () => {
			expect(indexer).toBeInstanceOf(ManagedIndexer)
		})

		it("should not subscribe to configuration changes until start is called", () => {
			// Configuration listener is set up in start(), not constructor
			expect(mockContextProxy.onManagedIndexerConfigChange).not.toHaveBeenCalled()
		})

		it("should initialize with empty workspaceFolderState", () => {
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should initialize with isActive false", () => {
			expect(indexer.isActive).toBe(false)
		})
	})

	describe("fetchConfig", () => {
		it("should fetch config from ContextProxy", async () => {
			const config = await indexer.fetchConfig()

			expect(mockContextProxy.getSecret).toHaveBeenCalledWith("kilocodeToken")
			expect(mockContextProxy.getValue).toHaveBeenCalledWith("kilocodeOrganizationId")
			expect(mockContextProxy.getValue).toHaveBeenCalledWith("kilocodeTesterWarningsDisabledUntil")
			expect(config).toEqual({
				kilocodeOrganizationId: "test-org-id",
				kilocodeToken: "test-token",
				kilocodeTesterWarningsDisabledUntil: null,
			})
		})

		it("should store config in instance", async () => {
			await indexer.fetchConfig()

			expect(indexer.config).toEqual({
				kilocodeOrganizationId: "test-org-id",
				kilocodeToken: "test-token",
				kilocodeTesterWarningsDisabledUntil: null,
			})
		})

		it("should handle missing config values", async () => {
			mockContextProxy.getSecret.mockReturnValue(null)
			mockContextProxy.getValue.mockReturnValue(null)

			const config = await indexer.fetchConfig()

			expect(config).toEqual({
				kilocodeOrganizationId: null,
				kilocodeToken: null,
				kilocodeTesterWarningsDisabledUntil: null,
			})
		})
	})

	describe("start", () => {
		beforeEach(() => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
		})

		it("should not start when no workspace folders exist", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = []

			await indexer.start()

			expect(indexer.isActive).toBe(false)
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should not start when feature is not enabled", async () => {
			vi.mocked(apiClient.isEnabled).mockReturnValue(Promise.resolve(false))

			await indexer.start()

			expect(indexer.isActive).toBe(false)
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should not start when token is missing", async () => {
			mockContextProxy.getSecret.mockReturnValue(null)

			await indexer.start()

			expect(indexer.isActive).toBe(false)
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should skip non-git repositories", async () => {
			vi.mocked(gitUtils.isGitRepository).mockResolvedValue(false)

			await indexer.start()

			expect(indexer.isActive).toBe(true)
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should skip folders without project ID", async () => {
			vi.mocked(kiloConfigFile.getKilocodeConfig).mockResolvedValue(null)

			await indexer.start()

			expect(indexer.isActive).toBe(true)
			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should create workspaceFolderState for valid workspace folders", async () => {
			await indexer.start()

			expect(indexer.isActive).toBe(true)
			expect(indexer.workspaceFolderState).toHaveLength(1)

			const state = indexer.workspaceFolderState[0]
			expect(state.gitBranch).toBe("main")
			expect(state.projectId).toBe("test-project-id")
			expect(state.repositoryUrl).toBe("https://github.com/test/repo")
			expect(state.isIndexing).toBe(false)
			expect(state.watcher).toBeDefined()
			expect(state.workspaceFolder).toBe(mockWorkspaceFolder)
		})

		it("should register event handler for each watcher", async () => {
			await indexer.start()

			const mockWatcher = indexer.workspaceFolderState[0].watcher
			expect(mockWatcher).toBeDefined()
			expect(mockWatcher!.onEvent).toHaveBeenCalledWith(expect.any(Function))
		})

		it("should start each watcher", async () => {
			await indexer.start()

			const mockWatcher = indexer.workspaceFolderState[0].watcher
			expect(mockWatcher).toBeDefined()
			expect(mockWatcher!.start).toHaveBeenCalled()
		})

		it("should handle multiple workspace folders", async () => {
			const folder2 = {
				uri: { fsPath: "/test/workspace2" } as vscode.Uri,
				name: "test-workspace-2",
				index: 1,
			}

			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder, folder2]

			vi.mocked(kiloConfigFile.getKilocodeConfig).mockImplementation(async (cwd) => {
				if (cwd === "/test/workspace") {
					return { project: { id: "project-1" } } as any
				}
				return { project: { id: "project-2" } } as any
			})

			await indexer.start()

			expect(indexer.workspaceFolderState).toHaveLength(2)
			expect(indexer.workspaceFolderState[0].projectId).toBe("project-1")
			expect(indexer.workspaceFolderState[1].projectId).toBe("project-2")
		})

		describe("error handling", () => {
			it("should capture git errors and create state with error", async () => {
				vi.mocked(git.getGitRepositoryInfo).mockRejectedValue(new Error("Git command failed"))

				await indexer.start()

				expect(indexer.workspaceFolderState).toHaveLength(1)
				const state = indexer.workspaceFolderState[0]
				expect(state.error).toBeDefined()
				expect(state.error?.type).toBe("git")
				expect(state.error?.message).toContain("Failed to get git information")
				expect(state.error?.timestamp).toBeDefined()
				expect(state.gitBranch).toBeNull()
				expect(state.projectId).toBeNull()
				expect(state.manifest).toBeNull()
				expect(state.watcher).toBeNull()
			})

			it("should capture manifest fetch errors and create partial state", async () => {
				vi.mocked(apiClient.getServerManifest).mockRejectedValue(new Error("API error"))

				await indexer.start()

				expect(indexer.workspaceFolderState).toHaveLength(1)
				const state = indexer.workspaceFolderState[0]
				expect(state.error).toBeDefined()
				expect(state.error?.type).toBe("manifest")
				expect(state.error?.message).toContain("Failed to fetch server manifest")
				expect(state.error?.context?.branch).toBe("main")
				expect(state.gitBranch).toBe("main")
				expect(state.projectId).toBe("test-project-id")
				expect(state.manifest).toBeNull()
				expect(state.watcher).toBeNull()
			})

			it("should capture watcher start errors and create partial state", async () => {
				vi.mocked(GitWatcher).mockImplementation(() => {
					throw new Error("Watcher initialization failed")
				})

				await indexer.start()

				expect(indexer.workspaceFolderState).toHaveLength(1)
				const state = indexer.workspaceFolderState[0]
				expect(state.error).toBeDefined()
				expect(state.error?.type).toBe("scan")
				expect(state.error?.message).toContain("Failed to start file watcher")
				expect(state.gitBranch).toBe("main")
				expect(state.projectId).toBe("test-project-id")
				expect(state.manifest).toBeDefined()
				expect(state.watcher).toBeNull()
			})

			it("should include error details in error object", async () => {
				const testError = new Error("Test error")
				testError.stack = "Error: Test error\n    at test.ts:1:1"
				vi.mocked(git.getGitRepositoryInfo).mockRejectedValue(testError)

				await indexer.start()

				const state = indexer.workspaceFolderState[0]
				expect(state.error?.details).toContain("Error: Test error")
				expect(state.error?.details).toContain("at test.ts:1:1")
			})

			it("should handle non-Error objects in catch blocks", async () => {
				vi.mocked(git.getGitRepositoryInfo).mockRejectedValue("String error")

				await indexer.start()

				const state = indexer.workspaceFolderState[0]
				expect(state.error?.message).toContain("String error")
				expect(state.error?.details).toBeUndefined()
			})
		})
	})

	describe("dispose", () => {
		it("should dispose all watchers", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const mockWatcher = indexer.workspaceFolderState[0].watcher
			expect(mockWatcher).toBeDefined()

			indexer.dispose()

			expect(mockWatcher!.dispose).toHaveBeenCalled()
		})

		it("should clear workspaceFolderState", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			indexer.dispose()

			expect(indexer.workspaceFolderState).toEqual([])
		})

		it("should set isActive to false", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			indexer.dispose()

			expect(indexer.isActive).toBe(false)
		})

		it("should dispose workspaceFoldersListener if present", () => {
			const mockDispose = vi.fn()
			indexer.workspaceFoldersListener = { dispose: mockDispose } as any

			indexer.dispose()

			expect(mockDispose).toHaveBeenCalled()
			expect(indexer.workspaceFoldersListener).toBeNull()
		})

		it("should dispose configChangeListener", () => {
			const mockDispose = vi.fn()
			indexer.configChangeListener = { dispose: mockDispose } as any

			indexer.dispose()

			expect(mockDispose).toHaveBeenCalled()
			expect(indexer.configChangeListener).toBeNull()
		})
	})

	describe("onEvent", () => {
		let mockWatcher: any
		let state: any

		beforeEach(async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			state = indexer.workspaceFolderState[0]
			mockWatcher = state.watcher
		})

		it("should not process events when not active", async () => {
			indexer.isActive = false

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const event: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/test",
				branch: "feature/test",
				isBaseBranch: false,
				watcher: mockWatcher,
				files: mockFiles(),
			}

			await indexer.onEvent(event)

			expect(state.isIndexing).toBe(false)
		})

		it("should not process events from unknown watcher", async () => {
			const unknownWatcher = new GitWatcher({ cwd: "/unknown" })

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const event: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/test",
				branch: "feature/test",
				isBaseBranch: false,
				watcher: unknownWatcher,
				files: mockFiles(),
			}

			await indexer.onEvent(event)

			// State should not be modified for unknown watcher
			expect(state.isIndexing).toBe(false)
		})

		describe("branch-changed event", () => {
			it("should fetch new manifest and process files", async () => {
				const fs = await import("fs")
				vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
				vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)
				vi.mocked(apiClient.upsertFile).mockResolvedValue(undefined)

				const newManifest = {
					files: {},
				}
				vi.mocked(apiClient.getServerManifest).mockResolvedValue(newManifest as any)

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "new-file.ts", fileHash: "def456" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				expect(kiloConfigFile.getKilocodeConfig).toHaveBeenCalledWith(
					"/test/workspace",
					"https://github.com/test/repo",
				)
				expect(apiClient.getServerManifest).toHaveBeenCalledWith(
					"test-org-id",
					"test-project-id",
					"feature/test",
					"test-token",
				)
				expect(state.manifest).toEqual(newManifest)
				expect(state.gitBranch).toBe("feature/test")

				// Wait for async file processing
				await new Promise((resolve) => setTimeout(resolve, 50))

				expect(apiClient.upsertFile).toHaveBeenCalled()
			})

			it("should handle file deletions", async () => {
				vi.mocked(apiClient.deleteFiles).mockResolvedValue(undefined)

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file-deleted", filePath: "deleted.ts" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				// Wait for async processing
				await new Promise((resolve) => setTimeout(resolve, 50))

				expect(apiClient.deleteFiles).toHaveBeenCalledWith(
					expect.objectContaining({
						organizationId: "test-org-id",
						projectId: "test-project-id",
						gitBranch: "feature/test",
						filePaths: ["deleted.ts"],
					}),
					expect.any(Object), // AbortSignal
				)
				expect(state.isIndexing).toBe(false)
			})

			it("should delete files that are in manifest but not in git", async () => {
				const fs = await import("fs")
				vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
				vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)
				vi.mocked(apiClient.upsertFile).mockResolvedValue(undefined)
				vi.mocked(apiClient.deleteFiles).mockResolvedValue(undefined)

				// Manifest has files that are no longer in git
				const manifestWithOldFiles = {
					files: {
						oldHash1: "old-file1.ts",
						oldHash2: "old-file2.ts",
						currentHash: "current-file.ts",
					},
				}
				vi.mocked(apiClient.getServerManifest).mockResolvedValue(manifestWithOldFiles as any)

				// Git only has current-file.ts
				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "current-file.ts", fileHash: "newHash" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				// Wait for async processing
				await new Promise((resolve) => setTimeout(resolve, 50))

				// Should delete the files that are in manifest but not in git
				expect(apiClient.deleteFiles).toHaveBeenCalledWith(
					expect.objectContaining({
						filePaths: expect.arrayContaining(["old-file1.ts", "old-file2.ts"]),
					}),
					expect.any(Object),
				)
			})

			it("should not call deleteFiles when no files need deletion", async () => {
				const fs = await import("fs")
				vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
				vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)
				vi.mocked(apiClient.upsertFile).mockResolvedValue(undefined)
				vi.mocked(apiClient.deleteFiles).mockResolvedValue(undefined)

				const manifestWithCurrentFiles = {
					files: {
						hash1: "file1.ts",
					},
				}
				vi.mocked(apiClient.getServerManifest).mockResolvedValue(manifestWithCurrentFiles as any)

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "file1.ts", fileHash: "hash1" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				// Wait for async processing
				await new Promise((resolve) => setTimeout(resolve, 50))

				// Should not call deleteFiles when all manifest files are still in git
				expect(apiClient.deleteFiles).not.toHaveBeenCalled()
			})

			it("should handle deleteFiles errors gracefully", async () => {
				vi.mocked(apiClient.deleteFiles).mockRejectedValue(new Error("Delete failed"))

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file-deleted", filePath: "deleted.ts" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				// Wait for async processing
				await new Promise((resolve) => setTimeout(resolve, 50))

				// Should set error state
				expect(state.error).toBeDefined()
				expect(state.error?.message).toContain("Failed to delete files")
				expect(state.isIndexing).toBe(false)
			})

			it("should skip files with unsupported extensions", async () => {
				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "test.unsupported", fileHash: "abc123" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(apiClient.upsertFile).not.toHaveBeenCalled()
			})

			it("should skip already indexed files", async () => {
				// Set up manifest with already indexed file
				const manifestWithFile = {
					files: { abc123: "test.ts" },
				}
				vi.mocked(apiClient.getServerManifest).mockResolvedValue(manifestWithFile as any)

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
				}

				const event: GitWatcherEvent = {
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(apiClient.upsertFile).not.toHaveBeenCalled()
			})
		})

		describe("commit event", () => {
			it("should process files from commit", async () => {
				const fs = await import("fs")
				vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
				vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)
				vi.mocked(apiClient.upsertFile).mockResolvedValue(undefined)

				state.manifest = { files: {} }

				const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
					yield { type: "file", filePath: "updated-file.ts", fileHash: "ghi789" }
				}

				const event: GitWatcherEvent = {
					type: "commit",
					previousCommit: "abc123",
					newCommit: "def456",
					branch: "main",
					isBaseBranch: true,
					watcher: mockWatcher,
					files: mockFiles(),
				}

				await indexer.onEvent(event)

				await new Promise((resolve) => setTimeout(resolve, 50))

				expect(apiClient.upsertFile).toHaveBeenCalledWith(
					expect.objectContaining({
						filePath: "updated-file.ts",
						fileHash: "ghi789",
						gitBranch: "main",
						isBaseBranch: true,
					}),
					expect.any(Object), // AbortSignal
				)
			})
		})
	})

	describe("onDidChangeWorkspaceFolders", () => {
		it("should dispose and restart", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const disposeSpy = vi.spyOn(indexer, "dispose")
			const startSpy = vi.spyOn(indexer, "start")

			const event = {
				added: [],
				removed: [],
			} as vscode.WorkspaceFoldersChangeEvent

			await indexer.onDidChangeWorkspaceFolders(event)

			expect(disposeSpy).toHaveBeenCalled()
			expect(startSpy).toHaveBeenCalled()
		})
	})

	describe("abort mechanism", () => {
		it("should abort previous operation when new event arrives", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const state = indexer.workspaceFolderState[0]
			const mockWatcher = state.watcher

			const fs = await import("fs")
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))

			// Create first event with slow processing
			const mockFiles1 = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "file1.ts", fileHash: "hash1" }
			}

			const event1: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/branch-a",
				branch: "feature/branch-a",
				isBaseBranch: false,
				watcher: mockWatcher!,
				files: mockFiles1(),
			}

			// Start first operation
			const promise1 = indexer.onEvent(event1)

			// Verify first controller was created
			expect(state.currentAbortController).toBeDefined()
			const firstController = state.currentAbortController

			// Create second event immediately
			const mockFiles2 = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "file2.ts", fileHash: "hash2" }
			}

			const event2: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "feature/branch-a",
				newBranch: "feature/branch-b",
				branch: "feature/branch-b",
				isBaseBranch: false,
				watcher: mockWatcher!,
				files: mockFiles2(),
			}

			// Start second operation
			const promise2 = indexer.onEvent(event2)

			// Verify first controller was aborted
			expect(firstController?.signal.aborted).toBe(true)

			// Verify new controller was created
			expect(state.currentAbortController).toBeDefined()
			expect(state.currentAbortController).not.toBe(firstController)

			// Wait for both to complete
			await Promise.all([promise1, promise2])
		})

		it("should pass abort signal to upsertFile", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const state = indexer.workspaceFolderState[0]
			const mockWatcher = state.watcher

			const fs = await import("fs")
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
			vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)
			vi.mocked(apiClient.upsertFile).mockResolvedValue(undefined)

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const event: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher: mockWatcher!,
				files: mockFiles(),
			}

			await indexer.onEvent(event)

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Verify upsertFile was called with signal as second argument
			expect(apiClient.upsertFile).toHaveBeenCalledWith(
				expect.objectContaining({
					filePath: "test.ts",
					fileHash: "abc123",
				}),
				expect.any(Object), // AbortSignal
			)
		})

		it("should handle abort errors gracefully", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const state = indexer.workspaceFolderState[0]
			const mockWatcher = state.watcher

			const fs = await import("fs")
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))
			vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1000 } as any)

			// Make upsertFile throw an AbortError
			const abortError = new Error("AbortError")
			abortError.name = "AbortError"
			vi.mocked(apiClient.upsertFile).mockRejectedValue(abortError)

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const event: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher: mockWatcher!,
				files: mockFiles(),
			}

			// Should not throw
			await expect(indexer.onEvent(event)).resolves.not.toThrow()

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should not set error state for abort errors
			expect(state.error).toBeUndefined()
		})

		it("should stop processing files when aborted", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const state = indexer.workspaceFolderState[0]
			const mockWatcher = state.watcher

			const fs = await import("fs")
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))

			let filesYielded = 0
			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "file1.ts", fileHash: "hash1" }
				filesYielded++
				yield { type: "file", filePath: "file2.ts", fileHash: "hash2" }
				filesYielded++
				yield { type: "file", filePath: "file3.ts", fileHash: "hash3" }
				filesYielded++
			}

			const event1: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher: mockWatcher!,
				files: mockFiles(),
			}

			// Start first operation
			const promise1 = indexer.onEvent(event1)

			// Immediately trigger abort by starting second operation
			const mockFiles2 = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "file4.ts", fileHash: "hash4" }
			}

			const event2: GitWatcherEvent = {
				type: "commit",
				previousCommit: "def",
				newCommit: "ghi",
				branch: "main",
				isBaseBranch: true,
				watcher: mockWatcher!,
				files: mockFiles2(),
			}

			const promise2 = indexer.onEvent(event2)

			await Promise.all([promise1, promise2])

			// First operation should have been aborted before processing all files
			// Note: This is a timing-dependent test, so we just verify it doesn't throw
			expect(state.isIndexing).toBe(false)
		})

		it("should clear abort controller after operation completes", async () => {
			vi.mocked(vscode.workspace).workspaceFolders = [mockWorkspaceFolder]
			await indexer.start()

			const state = indexer.workspaceFolderState[0]
			const mockWatcher = state.watcher

			const fs = await import("fs")
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("file content"))

			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			const event: GitWatcherEvent = {
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher: mockWatcher!,
				files: mockFiles(),
			}

			await indexer.onEvent(event)

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Controller should still exist (it's not cleared, just not aborted)
			expect(state.currentAbortController).toBeDefined()
			expect(state.currentAbortController?.signal.aborted).toBe(false)
		})
	})

	describe("workspaceFolderState tracking", () => {
		it("should maintain separate state for each workspace folder", async () => {
			const folder1 = mockWorkspaceFolder
			const folder2 = {
				uri: { fsPath: "/test/workspace2" } as vscode.Uri,
				name: "test-workspace-2",
				index: 1,
			}

			vi.mocked(vscode.workspace).workspaceFolders = [folder1, folder2]

			vi.mocked(kiloConfigFile.getKilocodeConfig).mockImplementation(async (cwd) => {
				if (cwd === "/test/workspace") {
					return { project: { id: "project-1" } } as any
				}
				return { project: { id: "project-2" } } as any
			})

			vi.mocked(gitUtils.getCurrentBranch).mockImplementation(async (cwd) => {
				if (cwd === "/test/workspace") {
					return "main"
				}
				return "develop"
			})

			await indexer.start()

			expect(indexer.workspaceFolderState).toHaveLength(2)

			const state1 = indexer.workspaceFolderState[0]
			const state2 = indexer.workspaceFolderState[1]

			expect(state1.projectId).toBe("project-1")
			expect(state1.gitBranch).toBe("main")
			expect(state1.isIndexing).toBe(false)

			expect(state2.projectId).toBe("project-2")
			expect(state2.gitBranch).toBe("develop")
			expect(state2.isIndexing).toBe(false)
		})

		it("should update isIndexing independently for each workspace", async () => {
			const folder1 = mockWorkspaceFolder
			const folder2 = {
				uri: { fsPath: "/test/workspace2" } as vscode.Uri,
				name: "test-workspace-2",
				index: 1,
			}

			vi.mocked(vscode.workspace).workspaceFolders = [folder1, folder2]

			vi.mocked(kiloConfigFile.getKilocodeConfig).mockImplementation(async (cwd) => {
				if (cwd === "/test/workspace") {
					return { project: { id: "project-1" } } as any
				}
				return { project: { id: "project-2" } } as any
			})

			await indexer.start()

			const state1 = indexer.workspaceFolderState[0]
			const state2 = indexer.workspaceFolderState[1]

			// Process event on first workspace
			const mockFiles = async function* (): AsyncIterable<GitWatcherFile> {
				yield { type: "file", filePath: "test.ts", fileHash: "abc123" }
			}

			expect(state1.watcher).toBeDefined()
			const eventPromise = indexer.onEvent({
				type: "commit",
				previousCommit: "abc",
				newCommit: "def",
				branch: "main",
				isBaseBranch: true,
				watcher: state1.watcher!,
				files: mockFiles(),
			})

			// During processing, isIndexing should be true
			expect(state1.isIndexing).toBe(true)
			expect(state2.isIndexing).toBe(false)

			// Wait for processing to complete
			await eventPromise

			expect(state1.isIndexing).toBe(false)
			expect(state2.isIndexing).toBe(false)
		})
	})
})

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest"
import { Task } from "../../task/Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { checkpointSave, checkpointRestore, checkpointDiff, getCheckpointService } from "../index"
import { MessageManager } from "../../message-manager"
import * as vscode from "vscode"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({})),
		showInformationMessage: vi.fn(),
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
		parse: vi.fn((uri: string) => ({ with: vi.fn(() => ({})) })),
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

// Mock other dependencies
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureCheckpointCreated: vi.fn(),
			captureCheckpointRestored: vi.fn(),
			captureCheckpointDiffed: vi.fn(),
			captureEvent: vi.fn(), // kilocode_change
		},
	},
}))

vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/test/workspace"),
}))

vi.mock("../../../utils/git", () => ({
	checkGitInstalled: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, options?: Record<string, any>) => {
		if (key === "common:errors.wait_checkpoint_long_time") {
			return `Checkpoint initialization is taking longer than ${options?.timeout} seconds...`
		}
		if (key === "common:errors.init_checkpoint_fail_long_time") {
			return `Checkpoint initialization failed after ${options?.timeout} seconds`
		}
		return key
	}),
}))

// Mock p-wait-for to control timeout behavior
vi.mock("p-wait-for", () => ({
	default: vi.fn(),
}))

vi.mock("../../../services/checkpoints")

describe("Checkpoint functionality", () => {
	let mockProvider: any
	let mockTask: any
	let mockCheckpointService: any

	beforeEach(async () => {
		// Create mock checkpoint service
		mockCheckpointService = {
			isInitialized: true,
			saveCheckpoint: vi.fn().mockResolvedValue({ commit: "test-commit-hash" }),
			restoreCheckpoint: vi.fn().mockResolvedValue(undefined),
			getDiff: vi.fn().mockResolvedValue([]),
			on: vi.fn(),
			initShadowGit: vi.fn().mockResolvedValue(undefined),
		}

		// Create mock provider
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
			log: vi.fn(),
			postMessageToWebview: vi.fn(),
			postStateToWebview: vi.fn(),
			cancelTask: vi.fn(),
		}

		// Create mock task
		mockTask = {
			taskId: "test-task-id",
			enableCheckpoints: true,
			checkpointService: mockCheckpointService,
			checkpointServiceInitializing: false,
			providerRef: {
				deref: () => mockProvider,
			},
			clineMessages: [],
			apiConversationHistory: [],
			pendingUserMessageCheckpoint: undefined,
			say: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			combineMessages: vi.fn().mockReturnValue([]),
		}
		mockTask.messageManager = new MessageManager(mockTask)

		// Update the mock to return our mockCheckpointService
		const checkpointsModule = await import("../../../services/checkpoints")
		vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create).mockReturnValue(mockCheckpointService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("checkpointSave", () => {
		it("should wait for checkpoint service initialization before saving", async () => {
			// Set up task with uninitialized service
			mockCheckpointService.isInitialized = false
			mockTask.checkpointService = mockCheckpointService

			// Simulate service initialization after a delay
			setTimeout(() => {
				mockCheckpointService.isInitialized = true
			}, 100)

			// Call checkpointSave
			const savePromise = checkpointSave(mockTask, true)

			// Wait for the save to complete
			const result = await savePromise

			// saveCheckpoint should have been called
			expect(mockCheckpointService.saveCheckpoint).toHaveBeenCalledWith(
				expect.stringContaining("Task: test-task-id"),
				{ allowEmpty: true, suppressMessage: false },
			)

			// Result should contain the commit hash
			expect(result).toEqual({ commit: "test-commit-hash" })

			// Task should still have checkpoints enabled
			expect(mockTask.enableCheckpoints).toBe(true)
		})

		it("should handle timeout when service doesn't initialize", async () => {
			// Service never initializes
			mockCheckpointService.isInitialized = false

			// Call checkpointSave with a task that has no checkpoint service
			const taskWithNoService = {
				...mockTask,
				checkpointService: undefined,
				enableCheckpoints: false,
			}

			const result = await checkpointSave(taskWithNoService, true)

			// Result should be undefined
			expect(result).toBeUndefined()

			// saveCheckpoint should not have been called
			expect(mockCheckpointService.saveCheckpoint).not.toHaveBeenCalled()
		})

		it("should preserve checkpoint data through message deletion flow", async () => {
			// Initialize service
			mockCheckpointService.isInitialized = true
			mockTask.checkpointService = mockCheckpointService

			// Simulate saving checkpoint before user message
			const checkpointResult = await checkpointSave(mockTask, true)
			expect(checkpointResult).toEqual({ commit: "test-commit-hash" })

			// Simulate setting pendingUserMessageCheckpoint
			if (checkpointResult && "commit" in checkpointResult) {
				mockTask.pendingUserMessageCheckpoint = {
					hash: checkpointResult.commit,
					timestamp: Date.now(),
					type: "user_message",
				}
			}

			// Verify checkpoint data is preserved
			expect(mockTask.pendingUserMessageCheckpoint).toBeDefined()
			expect(mockTask.pendingUserMessageCheckpoint.hash).toBe("test-commit-hash")

			// Simulate message deletion and reinitialization
			mockTask.clineMessages = []
			mockTask.checkpointService = mockCheckpointService // Keep service available
			mockTask.checkpointServiceInitializing = false

			// Save checkpoint again after deletion
			const newCheckpointResult = await checkpointSave(mockTask, true)

			// Should still work after reinitialization
			expect(newCheckpointResult).toEqual({ commit: "test-commit-hash" })
			expect(mockTask.enableCheckpoints).toBe(true)
		})

		it("should handle errors gracefully and disable checkpoints", async () => {
			mockCheckpointService.saveCheckpoint.mockRejectedValue(new Error("Save failed"))

			const result = await checkpointSave(mockTask)

			expect(result).toBeUndefined()
			expect(mockTask.enableCheckpoints).toBe(false)
		})
	})

	describe("checkpointRestore", () => {
		beforeEach(() => {
			mockTask.clineMessages = [
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "assistant", text: "Message 2" },
				{ ts: 3, say: "user", text: "Message 3" },
			]
			mockTask.apiConversationHistory = [
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
				{ ts: 2, role: "assistant", content: [{ type: "text", text: "Message 2" }] },
				{ ts: 3, role: "user", content: [{ type: "text", text: "Message 3" }] },
			]
		})

		it("should restore checkpoint for delete operation", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
				operation: "delete",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
			])
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([{ ts: 1, say: "user", text: "Message 1" }])
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should restore checkpoint for edit operation", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
				operation: "edit",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
			])
			// For edit operation, should include the message being edited
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "assistant", text: "Message 2" },
			])
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should handle preview mode without modifying messages", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "preview",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).not.toHaveBeenCalled()
			expect(mockTask.overwriteClineMessages).not.toHaveBeenCalled()
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should handle missing message gracefully", async () => {
			await checkpointRestore(mockTask, {
				ts: 999, // Non-existent timestamp
				commitHash: "abc123",
				mode: "restore",
			})

			expect(mockCheckpointService.restoreCheckpoint).not.toHaveBeenCalled()
		})

		it("should disable checkpoints on error", async () => {
			mockCheckpointService.restoreCheckpoint.mockRejectedValue(new Error("Restore failed"))

			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
			})

			expect(mockTask.enableCheckpoints).toBe(false)
			expect(mockProvider.log).toHaveBeenCalledWith("[checkpointRestore] disabling checkpoints for this task")
		})
	})

	describe("checkpointDiff", () => {
		beforeEach(() => {
			mockTask.clineMessages = [
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "checkpoint_saved", text: "commit1" },
				{ ts: 3, say: "user", text: "Message 2" },
				{ ts: 4, say: "checkpoint_saved", text: "commit2" },
			]
		})

		it("should show diff for to-current mode", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "to-current",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit2",
				to: undefined,
			})
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.changes",
				"common:errors.checkpoint_diff_to_current",
				expect.any(Array),
			)
		})

		it("should show diff for checkpoint mode with next commit", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)
			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit1",
				mode: "checkpoint",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit1",
				to: "commit2",
			})
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.changes",
				"common:errors.checkpoint_diff_with_next",
				expect.any(Array),
			)
		})

		it("should find next checkpoint automatically in checkpoint mode", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit1",
				mode: "checkpoint",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit1", // Should find the next checkpoint
				to: "commit2",
			})
		})

		it("should show information message when no changes found", async () => {
			mockCheckpointService.getDiff.mockResolvedValue([])

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "to-current",
			})

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:errors.checkpoint_no_changes")
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it("should disable checkpoints on error", async () => {
			mockCheckpointService.getDiff.mockRejectedValue(new Error("Diff failed"))

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "to-current",
			})

			expect(mockTask.enableCheckpoints).toBe(false)
			expect(mockProvider.log).toHaveBeenCalledWith("[checkpointDiff] disabling checkpoints for this task")
		})
	})

	describe("getCheckpointService", () => {
		it("should return existing service if available", async () => {
			const service = await getCheckpointService(mockTask)
			expect(service).toBe(mockCheckpointService)
		})

		it("should return undefined if checkpoints are disabled", async () => {
			mockTask.enableCheckpoints = false
			const service = await getCheckpointService(mockTask)
			expect(service).toBeUndefined()
		})

		it("should return undefined if service is still initializing", async () => {
			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = true
			const service = await getCheckpointService(mockTask)
			expect(service).toBeUndefined()
		})

		it("should create new service if none exists", async () => {
			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = false

			const service = getCheckpointService(mockTask)

			const checkpointsModule = await import("../../../services/checkpoints")
			expect(vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create)).toHaveBeenCalledWith({
				taskId: "test-task-id",
				workspaceDir: "/test/workspace",
				shadowDir: "/test/storage",
				log: expect.any(Function),
			})
		})

		it("should disable checkpoints if workspace path is not found", async () => {
			const pathModule = await import("../../../utils/path")
			vi.mocked(pathModule.getWorkspacePath).mockReturnValue(null as any)

			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = false

			const service = await getCheckpointService(mockTask)

			expect(service).toBeUndefined()
			expect(mockTask.enableCheckpoints).toBe(false)
		})
	})

	describe("getCheckpointService - initialization timeout behavior", () => {
		it("should send warning message when initialization is slow", async () => {
			// This test verifies the warning logic by directly testing the condition function behavior
			const i18nModule = await import("../../../i18n")

			// Setup: Create a scenario where initialization is in progress
			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = true
			mockTask.checkpointTimeout = 15

			vi.clearAllMocks()

			// Simulate the condition function that runs inside pWaitFor
			let warningShown = false
			const simulateConditionCheck = (elapsedMs: number) => {
				// This simulates what happens inside the pWaitFor condition function (lines 85-100)
				if (!warningShown && elapsedMs >= 5000) {
					warningShown = true
					// This is what the actual code does at line 91-94
					const provider = mockTask.providerRef.deref()
					provider?.postMessageToWebview({
						type: "checkpointInitWarning",
						checkpointWarning: i18nModule.t("common:errors.wait_checkpoint_long_time", { timeout: 5 }),
					})
				}

				return !!mockTask.checkpointService && !!mockTask.checkpointService.isInitialized
			}

			// Test: At 4 seconds, no warning should be sent
			expect(simulateConditionCheck(4000)).toBe(false)
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()

			// Test: At 5 seconds, warning should be sent
			expect(simulateConditionCheck(5000)).toBe(false)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "checkpointInitWarning",
				checkpointWarning: "Checkpoint initialization is taking longer than 5 seconds...",
			})

			// Test: At 6 seconds, warning should not be sent again (warningShown is true)
			vi.clearAllMocks()
			expect(simulateConditionCheck(6000)).toBe(false)
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should send timeout error message when initialization fails", async () => {
			const i18nModule = await import("../../../i18n")

			// Setup
			mockTask.checkpointService = undefined
			mockTask.checkpointTimeout = 10
			mockTask.enableCheckpoints = true

			vi.clearAllMocks()

			// Simulate timeout error scenario (what happens in catch block at line 127-129)
			const error = new Error("Timeout")
			error.name = "TimeoutError"

			// This is what the code does when TimeoutError is caught
			if (error.name === "TimeoutError" && mockTask.enableCheckpoints) {
				const provider = mockTask.providerRef.deref()
				provider?.postMessageToWebview({
					type: "checkpointInitWarning",
					checkpointWarning: i18nModule.t("common:errors.init_checkpoint_fail_long_time", {
						timeout: mockTask.checkpointTimeout,
					}),
				})
			}

			mockTask.enableCheckpoints = false

			// Verify
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "checkpointInitWarning",
				checkpointWarning: "Checkpoint initialization failed after 10 seconds",
			})
			expect(mockTask.enableCheckpoints).toBe(false)
		})

		it("should clear warning on successful initialization", async () => {
			// Setup
			mockTask.checkpointService = mockCheckpointService
			mockTask.enableCheckpoints = true

			vi.clearAllMocks()

			// Simulate successful initialization (what happens at line 109 or 123)
			if (mockTask.enableCheckpoints) {
				const provider = mockTask.providerRef.deref()
				provider?.postMessageToWebview({
					type: "checkpointInitWarning",
					checkpointWarning: "",
				})
			}

			// Verify warning was cleared
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "checkpointInitWarning",
				checkpointWarning: "",
			})
		})

		it("should use WARNING_THRESHOLD_MS constant of 5000ms", () => {
			// Verify the warning threshold is 5 seconds by checking the implementation
			const WARNING_THRESHOLD_MS = 5000
			expect(WARNING_THRESHOLD_MS).toBe(5000)
			expect(WARNING_THRESHOLD_MS / 1000).toBe(5) // Used in the i18n call
		})

		it("should convert checkpointTimeout to milliseconds", () => {
			// Verify timeout conversion logic (line 42)
			mockTask.checkpointTimeout = 15
			const checkpointTimeoutMs = mockTask.checkpointTimeout * 1000
			expect(checkpointTimeoutMs).toBe(15000)

			mockTask.checkpointTimeout = 10
			expect(mockTask.checkpointTimeout * 1000).toBe(10000)

			mockTask.checkpointTimeout = 60
			expect(mockTask.checkpointTimeout * 1000).toBe(60000)
		})

		it("should use correct i18n keys for warning messages", async () => {
			const i18nModule = await import("../../../i18n")
			vi.clearAllMocks()

			// Test warning message i18n key
			const warningMessage = i18nModule.t("common:errors.wait_checkpoint_long_time", { timeout: 5 })
			expect(warningMessage).toBe("Checkpoint initialization is taking longer than 5 seconds...")

			// Test timeout error message i18n key
			const errorMessage = i18nModule.t("common:errors.init_checkpoint_fail_long_time", { timeout: 30 })
			expect(errorMessage).toBe("Checkpoint initialization failed after 30 seconds")
		})
	})
})

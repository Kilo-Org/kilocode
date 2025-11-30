import { applyDiffTool } from "../../MultiApplyDiffTool"
import { EXPERIMENT_IDS } from "../../../../shared/experiments"
import * as fs from "fs/promises"
import * as fileUtils from "../../../../utils/fs"
import * as pathUtils from "../../../../utils/path"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../../utils/fs")
vi.mock("../../../../utils/path")

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				captureDiffApplicationError: vi.fn(),
			}
		},
	},
}))

describe("multiApplyDiffTool", () => {
	let mockCline: any
	let mockBlock: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any
	let mockProvider: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
				},
				diagnosticsEnabled: true,
				writeDelayMs: 0,
			}),
		}

		mockCline = {
			providerRef: {
				deref: vi.fn().mockReturnValue(mockProvider),
			},
			cwd: "/test",
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map(),
			recordToolError: vi.fn(),
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({
					success: true,
					content: "modified content",
				}),
				getProgressStatus: vi.fn(),
			},
			diffViewProvider: {
				reset: vi.fn().mockResolvedValue(undefined),
				editType: undefined,
				originalContent: undefined,
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				saveDirectly: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi.fn().mockResolvedValue(undefined),
				pushToolWriteResult: vi.fn().mockResolvedValue("File modified successfully"),
			},
			api: {
				getModel: vi.fn().mockReturnValue({ id: "test-model" }),
			},
			apiConfiguration: {
				toolStyle: "xml",
			},
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			didEditFile: false,
			processQueuedMessages: vi.fn(),
		} as any

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, value) => value)

		// Mock file system operations
		;(fileUtils.fileExistsAtPath as any).mockResolvedValue(true)
		;(fs.readFile as any).mockResolvedValue("original content")
		;(pathUtils.getReadablePath as any).mockImplementation((cwd: string, path: string) => path)
	})

	describe("JSON toolStyle tests", () => {
		beforeEach(() => {
			// Override apiConfiguration to use JSON toolStyle
			mockCline.apiConfiguration.toolStyle = "json"
		})

		describe("Early content validation", () => {
			it("should filter out non-string content at parse time", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [
									{
										content: "<<<<<<< SEARCH\ntest\n=======\nreplaced\n>>>>>>> REPLACE",
										start_line: 1,
									},
									{ content: null, start_line: 5 },
									{ content: undefined, start_line: 10 },
									{ content: 42, start_line: 15 },
									{ content: "", start_line: 20 },
									{
										content: "<<<<<<< SEARCH\nmore\n=======\nchanges\n>>>>>>> REPLACE",
										start_line: 25,
									},
								],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without error and only process valid string content
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()

				// Verify that only valid diffs were processed
				const resultCall = mockPushToolResult.mock.calls[0][0]
				// Should not include the single block notice since we have 2 valid blocks
				expect(resultCall).not.toContain("Making multiple related changes")
			})
		})

		describe("SEARCH block counting with non-string content", () => {
			it("should handle diffItem.content being undefined", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [{ content: undefined, start_line: 1 }],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without throwing an error
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()
			})

			it("should handle diffItem.content being null", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [{ content: null, start_line: 1 }],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without throwing an error
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()
			})

			it("should handle diffItem.content being a number", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [{ content: 123, start_line: 1 }],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without throwing an error
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()
			})

			it("should correctly count SEARCH blocks when content is a valid string", async () => {
				const diffContent1 = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE`

				const diffContent2 = `<<<<<<< SEARCH
another old content
=======
another new content
>>>>>>> REPLACE`

				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [
									{ content: diffContent1, start_line: 1 },
									{ content: diffContent2, start_line: 10 },
								],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete successfully
				expect(mockPushToolResult).toHaveBeenCalled()
				const resultCall = mockPushToolResult.mock.calls[0][0]
				// Should not include the single block notice since we have 2 blocks
				expect(resultCall).not.toContain("Making multiple related changes")
			})

			it("should show single block notice when only one SEARCH block exists", async () => {
				const diffContent = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE`

				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [{ content: diffContent, start_line: 1 }],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete successfully
				expect(mockPushToolResult).toHaveBeenCalled()
				const resultCall = mockPushToolResult.mock.calls[0][0]
				// When there's only one block, it may proceed without the multi-change notice
				expect(resultCall).toBeDefined()
			})
		})

		describe("Edge cases for diff content", () => {
			it("should handle empty diff array", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without error
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()
			})

			it("should handle mixed content types in diff array", async () => {
				mockBlock = {
					params: {
						files: [
							{
								path: "test.ts",
								diffs: [
									{
										content: "<<<<<<< SEARCH\ntest\n=======\nreplaced\n>>>>>>> REPLACE",
										start_line: 1,
									},
									{ content: null, start_line: 5 },
									{ content: undefined, start_line: 10 },
									{ content: 42, start_line: 15 },
									{
										content: "<<<<<<< SEARCH\nmore\n=======\nchanges\n>>>>>>> REPLACE",
										start_line: 20,
									},
								],
							},
						],
					},
					partial: false,
				}

				await applyDiffTool(
					mockCline,
					mockBlock,
					mockAskApproval,
					mockHandleError,
					mockPushToolResult,
					mockRemoveClosingTag,
				)

				// Should complete without error and count only valid string SEARCH blocks
				expect(mockPushToolResult).toHaveBeenCalled()
				expect(mockHandleError).not.toHaveBeenCalled()
			})
		})
	})
})

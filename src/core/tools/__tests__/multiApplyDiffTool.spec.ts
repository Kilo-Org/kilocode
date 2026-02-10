import { applyDiffTool } from "../MultiApplyDiffTool"
import { applyDiffTool as applyDiffToolClass } from "../ApplyDiffTool"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import * as fs from "fs/promises"
import * as fileUtils from "../../../utils/fs"
import * as pathUtils from "../../../utils/path"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/xml")

// Mock the ApplyDiffTool class-based tool that MultiApplyDiffTool delegates to for native protocol
vi.mock("../ApplyDiffTool", () => ({
	applyDiffTool: {
		handle: vi.fn().mockResolvedValue(undefined),
	},
}))

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
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			api: {
				getModel: vi.fn().mockReturnValue({
					id: "test-model",
					info: {
						maxTokens: 4096,
						contextWindow: 128000,
						supportsPromptCache: false,
						supportsNativeTools: false,
					},
				}),
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

	describe("Native protocol delegation", () => {
		it("should delegate to applyDiffToolClass.handle for XML args format", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content>valid string content</content>
						</diff>
					</file>`,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
			expect(applyDiffToolClass.handle).toHaveBeenCalledWith(
				mockCline,
				mockBlock,
				expect.objectContaining({
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: mockRemoveClosingTag,
					toolProtocol: "native",
				}),
			)
		})

		it("should delegate to applyDiffToolClass.handle for legacy path/diff params", async () => {
			mockBlock = {
				params: {
					path: "test.ts",
					diff: "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE",
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
			expect(applyDiffToolClass.handle).toHaveBeenCalledWith(
				mockCline,
				mockBlock,
				expect.objectContaining({
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: mockRemoveClosingTag,
					toolProtocol: "native",
				}),
			)
		})

		it("should handle undefined diff content by delegating to class-based tool", async () => {
			mockBlock = {
				params: {
					path: "test.ts",
					diff: undefined,
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

			// Should delegate to the class-based tool (which will handle the error)
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
		})

		it("should handle null diff content by delegating to class-based tool", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content></content>
						</diff>
					</file>`,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
		})

		it("should delegate multiple SEARCH blocks to class-based tool", async () => {
			const diffContent = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE

<<<<<<< SEARCH
another old content
=======
another new content
>>>>>>> REPLACE`

			mockBlock = {
				params: {
					path: "test.ts",
					diff: diffContent,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
		})

		it("should delegate single SEARCH block to class-based tool", async () => {
			const diffContent = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE`

			mockBlock = {
				params: {
					path: "test.ts",
					diff: diffContent,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
		})
	})

	describe("Edge cases for diff content", () => {
		it("should handle empty diff by delegating to class-based tool", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff></diff>
					</file>`,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})

		it("should handle mixed content types by delegating to class-based tool", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content>valid string content</content>
						</diff>
					</file>`,
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

			// Should delegate to the class-based tool
			expect(applyDiffToolClass.handle).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})
	})
})

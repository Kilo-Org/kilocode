import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAllowedJSONToolsForMode } from "../getAllowedJSONToolsForMode"
import { Mode } from "../../../../../shared/modes"
import { ClineProvider, ClineProviderState } from "../../../../webview/ClineProvider"
import { apply_diff_multi_file, apply_diff_single_file } from "../apply_diff"
import { CodeIndexManager } from "../../../../../services/code-index/manager"
import { McpServerManager } from "../../../../../services/mcp/McpServerManager"
import { ContextProxy } from "../../../../config/ContextProxy"
import * as vscode from "vscode"
import search_and_replace from "../search_and_replace"

// Mock ManagedIndexer before other mocks
vi.mock("../../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: vi.fn().mockReturnValue({
			isEnabled: vi.fn().mockReturnValue(false),
			organization: null,
		}),
	},
}))

vi.mock("vscode")
vi.mock("../../../../../services/code-index/manager")
vi.mock("../../../../../services/mcp/McpServerManager")
vi.mock("../../../../config/ContextProxy")

describe("getAllowedJSONToolsForMode", () => {
	let mockProvider: Partial<ClineProvider>
	let mockContext: any
	const modelWithImages = {
		id: "mock-model",
		info: { contextWindow: 2048, supportsPromptCache: false, supportsImages: true },
	}
	const modelWithoutImages = {
		id: "mock-model",
		info: { contextWindow: 2048, supportsPromptCache: false, supportsImages: false },
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			subscriptions: [],
		}

		mockProvider = {
			context: mockContext,
			getState: vi.fn(),
		}

		// Mock ContextProxy static getter
		vi.spyOn(ContextProxy, "instance", "get").mockReturnValue({
			rawContext: mockContext,
		} as any)

		// Mock vscode workspace
		vi.mocked(vscode.workspace).workspaceFolders = undefined

		// Mock CodeIndexManager
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue(undefined)

		// Mock McpServerManager
		vi.mocked(McpServerManager.getInstance).mockResolvedValue(undefined as any)
	})

	describe("apply_diff tool selection", () => {
		it("should use single file diff when multiFileApplyDiff experiment is disabled", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {
					multiFileApplyDiff: false,
				},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				undefined,
			)

			const applyDiffTool = tools.find((tool) => "function" in tool && tool.function.name === "apply_diff")
			expect(applyDiffTool).toBeDefined()
			expect(applyDiffTool).toEqual(search_and_replace)
			expect(applyDiffTool).not.toEqual(apply_diff_multi_file)
		})

		it("should use multi file diff when multiFileApplyDiff experiment is enabled", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {
					multiFileApplyDiff: true,
				},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				undefined,
			)

			const applyDiffTool = tools.find((tool) => "function" in tool && tool.function.name === "apply_diff")
			expect(applyDiffTool).toBeDefined()
			expect(applyDiffTool).toEqual(apply_diff_multi_file)
			expect(applyDiffTool).not.toEqual(search_and_replace)
		})

		it("should not include apply_diff when diffEnabled is false", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {
					multiFileApplyDiff: true,
				},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				false,
				undefined,
			)

			const applyDiffTool = tools.find((tool) => "function" in tool && tool.function.name === "apply_diff")
			expect(applyDiffTool).toBeUndefined()
		})
	})

	describe("no duplicate tools", () => {
		it("should not return duplicate tools", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			// Check for duplicate tool names
			const toolNames = tools.map((tool) => ("function" in tool ? tool.function.name : ""))
			const uniqueToolNames = new Set(toolNames)

			expect(toolNames.length).toBe(uniqueToolNames.size)
		})

		it("should return consistent tool count across multiple calls", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools1 = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)
			const tools2 = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			expect(tools1.length).toBe(tools2.length)
		})
	})

	describe("tool filtering", () => {
		it("should exclude codebase_search when CodeIndexManager is not available", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)
			vi.mocked(CodeIndexManager.getInstance).mockReturnValue(undefined)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const codebaseSearchTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "codebase_search",
			)
			expect(codebaseSearchTool).toBeUndefined()
		})

		it("should exclude browser_action when browserToolEnabled is false", async () => {
			const providerState: Partial<ClineProviderState> = {
				browserToolEnabled: false,
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const browserActionTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "browser_action",
			)
			expect(browserActionTool).toBeUndefined()
		})

		it("should exclude browser_action when supportsImages is false", async () => {
			const providerState: Partial<ClineProviderState> = {
				browserToolEnabled: true,
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithoutImages,
			)

			const browserActionTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "browser_action",
			)
			expect(browserActionTool).toBeUndefined()
		})

		it("should exclude update_todo_list when todoListEnabled is false", async () => {
			const providerState: Partial<ClineProviderState> = {
				apiConfiguration: {
					todoListEnabled: false,
				},
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const todoListTool = tools.find((tool) => "function" in tool && tool.function.name === "update_todo_list")
			expect(todoListTool).toBeUndefined()
		})

		it("should exclude generate_image when imageGeneration experiment is disabled", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {
					imageGeneration: false,
				},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const generateImageTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "generate_image",
			)
			expect(generateImageTool).toBeUndefined()
		})

		it("should exclude run_slash_command when runSlashCommand experiment is disabled", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {
					runSlashCommand: false,
				},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const runSlashCommandTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "run_slash_command",
			)
			expect(runSlashCommandTool).toBeUndefined()
		})
	})

	describe("always available tools", () => {
		it("should always include ask_followup_question", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const askTool = tools.find((tool) => "function" in tool && tool.function.name === "ask_followup_question")
			expect(askTool).toBeDefined()
		})

		it("should always include attempt_completion", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithoutImages,
			)

			const completionTool = tools.find(
				(tool) => "function" in tool && tool.function.name === "attempt_completion",
			)
			expect(completionTool).toBeDefined()
		})

		it("should always include switch_mode", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const switchModeTool = tools.find((tool) => "function" in tool && tool.function.name === "switch_mode")
			expect(switchModeTool).toBeDefined()
		})

		it("should always include new_task", async () => {
			const providerState: Partial<ClineProviderState> = {
				experiments: {},
			}

			vi.mocked(mockProvider.getState!).mockResolvedValue(providerState as ClineProviderState)

			const tools = await getAllowedJSONToolsForMode(
				"code" as Mode,
				mockProvider as ClineProvider,
				true,
				modelWithImages,
			)

			const newTaskTool = tools.find((tool) => "function" in tool && tool.function.name === "new_task")
			expect(newTaskTool).toBeDefined()
		})
	})
})

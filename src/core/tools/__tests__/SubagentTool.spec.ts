import { subagentTool } from "../SubagentTool"
import type { ToolUse } from "../../../shared/tools"

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: (msg: string) => `Tool Error: ${msg}`,
		toolResult: (content: string) => content,
	},
}))

const mockRunSubagentInBackground =
	vi.fn<(p: { parentTaskId: string; prompt: string; subagentType: "general" | "explore" }) => Promise<string>>()
const mockSay = vi.fn()
const mockPushToolResult = vi.fn()
const mockHandleError = vi.fn()
const mockSayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")
const mockRecordToolError = vi.fn()

const mockTask = {
	taskId: "parent-1",
	consecutiveMistakeCount: 0,
	didToolFailInCurrentTurn: false,
	recordToolError: mockRecordToolError,
	sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
	say: mockSay,
	providerRef: {
		deref: () => ({
			runSubagentInBackground: mockRunSubagentInBackground,
		}),
	},
}

describe("SubagentTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRunSubagentInBackground.mockResolvedValue("Subagent completed successfully.")
	})

	describe("parseLegacy", () => {
		it("parses description, prompt, and subagent_type", () => {
			const params = subagentTool.parseLegacy({
				description: "Do something",
				prompt: "Detailed instructions",
				subagent_type: "explore",
			})
			expect(params).toEqual({
				description: "Do something",
				prompt: "Detailed instructions",
				subagent_type: "explore",
			})
		})

		it("defaults subagent_type to general when invalid", () => {
			const params = subagentTool.parseLegacy({
				description: "X",
				prompt: "Y",
				subagent_type: "invalid",
			})
			expect(params.subagent_type).toBe("general")
		})
	})

	describe("execute", () => {
		it("calls runSubagentInBackground and pushes result on success", async () => {
			const block: ToolUse<"subagent"> = {
				type: "tool_use",
				name: "subagent",
				params: {},
				partial: false,
				nativeArgs: {
					description: "Explore files",
					prompt: "List files in src/",
					subagent_type: "explore",
				},
			}

			await subagentTool.execute(block.nativeArgs!, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockRunSubagentInBackground).toHaveBeenCalledWith(
				expect.objectContaining({
					parentTaskId: "parent-1",
					prompt: "List files in src/",
					subagentType: "explore",
				}),
			)
			expect(mockRunSubagentInBackground).toHaveBeenCalledWith(
				expect.objectContaining({
					onProgress: expect.any(Function),
				}),
			)
			expect(mockSay).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith("Subagent completed successfully.")
		})

		it("pushes error when description is missing", async () => {
			await subagentTool.execute(
				{ description: "", prompt: "Do it", subagent_type: "general" },
				mockTask as any,
				{
					askApproval: vi.fn(),
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: vi.fn(),
					toolProtocol: "native",
				},
			)

			expect(mockRunSubagentInBackground).not.toHaveBeenCalled()
			expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("subagent", "description")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing param error")
		})

		it("pushes error when prompt is missing", async () => {
			await subagentTool.execute({ description: "X", prompt: "", subagent_type: "general" }, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockRunSubagentInBackground).not.toHaveBeenCalled()
			expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("subagent", "prompt")
		})

		it("calls handleError and pushes tool error when runSubagentInBackground rejects", async () => {
			mockRunSubagentInBackground.mockRejectedValue(new Error("API failed"))

			await subagentTool.execute({ description: "X", prompt: "Y", subagent_type: "general" }, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockHandleError).toHaveBeenCalledWith("running subagent", expect.any(Error))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("API failed"))
		})
	})
})

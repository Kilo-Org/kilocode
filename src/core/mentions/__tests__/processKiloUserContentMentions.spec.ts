// Regression test for slash command processing in tool_result blocks
// This test will FAIL with the current implementation because parseKiloSlashCommands
// is not called for tool_result blocks. It should pass after the bug is fixed.

// **The Bug:**
// In `src/core/mentions/processKiloUserContentMentions.ts`, the function calls `parseKiloSlashCommands` for `text` blocks but NOT for `tool_result` blocks. This means when a user answers with a slash command to a tool like "ask for feedback", the command is ignored.

// **Expected Behavior:**
// When the tests pass, the bug will be fixed and slash commands in tool responses will be properly processed.

import { processKiloUserContentMentions } from "../processKiloUserContentMentions"
import { parseMentions } from "../index"
import { parseKiloSlashCommands } from "../../slash-commands/kilo"
import { refreshWorkflowToggles } from "../../context/instructions/workflows"
import { ensureLocalKilorulesDirExists } from "../../context/instructions/kilo-rules"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import { FileContextTracker } from "../../context-tracking/FileContextTracker"
import * as vscode from "vscode"

// Mock dependencies
vi.mock("../index", () => ({
	parseMentions: vi.fn(),
}))

vi.mock("../../slash-commands/kilo", () => ({
	parseKiloSlashCommands: vi.fn(),
}))

vi.mock("../../context/instructions/workflows", () => ({
	refreshWorkflowToggles: vi.fn(),
}))

vi.mock("../../context/instructions/kilo-rules", () => ({
	ensureLocalKilorulesDirExists: vi.fn(),
}))

describe("processKiloUserContentMentions - slash command regression", () => {
	const mockContext = {} as vscode.ExtensionContext
	const mockUrlContentFetcher = {} as UrlContentFetcher
	const mockFileContextTracker = {} as FileContextTracker
	const mockRooIgnoreController = {} as any

	beforeEach(() => {
		vi.clearAllMocks()

		// Default mocks
		vi.mocked(parseMentions).mockImplementation(async (text) => ({
			text: `parsed: ${text}`,
			mode: undefined,
		}))

		vi.mocked(parseKiloSlashCommands).mockImplementation(async (text, localToggles, globalToggles) => ({
			processedText: text,
			needsRulesFileCheck: false,
		}))

		vi.mocked(refreshWorkflowToggles).mockResolvedValue({
			localWorkflowToggles: {},
			globalWorkflowToggles: {},
		})

		vi.mocked(ensureLocalKilorulesDirExists).mockResolvedValue(false)
	})

	const defaultParams = {
		context: mockContext,
		cwd: "/test",
		urlContentFetcher: mockUrlContentFetcher,
		fileContextTracker: mockFileContextTracker,
		rooIgnoreController: mockRooIgnoreController,
		showRooIgnoredFiles: false,
		includeDiagnosticMessages: true,
		maxDiagnosticMessages: 50,
	}

	describe("slash command processing in tool_result blocks", () => {
		it("should call parseKiloSlashCommands for tool_result with string content containing <user_message> and slash command", async () => {
			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "call_123",
					content: "<user_message>/just-do-this-workflow.md</user_message>",
				},
			]

			const [result] = await processKiloUserContentMentions({
				...defaultParams,
				userContent,
			})

			// Verify parseKiloSlashCommands was called with the text after parseMentions
			expect(parseKiloSlashCommands).toHaveBeenCalledWith(
				"parsed: <user_message>/just-do-this-workflow.md</user_message>",
				{},
				{},
			)

			// The content should be the processed result from parseKiloSlashCommands
			expect(result[0]).toEqual({
				type: "tool_result",
				tool_use_id: "call_123",
				content: "parsed: <user_message>/just-do-this-workflow.md</user_message>",
			})
		})

		it("should call parseKiloSlashCommands for tool_result with array content containing <user_message> and slash command", async () => {
			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "call_456",
					content: [
						{
							type: "text" as const,
							text: "<user_message>/newtask</user_message>",
						},
					],
				},
			]

			const [result] = await processKiloUserContentMentions({
				...defaultParams,
				userContent,
			})

			// Verify parseKiloSlashCommands was called
			expect(parseKiloSlashCommands).toHaveBeenCalledWith("parsed: <user_message>/newtask</user_message>", {}, {})

			// The content array should have the processed text
			expect(result[0]).toEqual({
				type: "tool_result",
				tool_use_id: "call_456",
				content: [
					{
						type: "text",
						text: "parsed: <user_message>/newtask</user_message>",
					},
				],
			})
		})

		it("should handle slash command transformation in tool_result", async () => {
			// Mock parseKiloSlashCommands to actually transform the slash command
			vi.mocked(parseKiloSlashCommands).mockResolvedValue({
				processedText:
					'<explicit_instructions type="new_task">\n</explicit_instructions>\n<user_message></user_message>',
				needsRulesFileCheck: false,
			})

			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "call_789",
					content: "<user_message>/newtask</user_message>",
				},
			]

			const [result] = await processKiloUserContentMentions({
				...defaultParams,
				userContent,
			})

			// The content should be the transformed text
			expect(result[0]).toEqual({
				type: "tool_result",
				tool_use_id: "call_789",
				content:
					'<explicit_instructions type="new_task">\n</explicit_instructions>\n<user_message></user_message>',
			})
		})

		it("should not call parseKiloSlashCommands for tool_result without mention tags", async () => {
			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "call_999",
					content: "Just regular feedback without special tags",
				},
			]

			await processKiloUserContentMentions({
				...defaultParams,
				userContent,
			})

			// parseMentions should not be called because no mention tags
			expect(parseMentions).not.toHaveBeenCalled()
			// parseKiloSlashCommands should not be called
			expect(parseKiloSlashCommands).not.toHaveBeenCalled()
		})
	})
})

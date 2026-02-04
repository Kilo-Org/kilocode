// npx vitest core/mentions/__tests__/processUserContentMentions.spec.ts

import { processUserContentMentions } from "../processUserContentMentions"
import { parseMentions } from "../index"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import { FileContextTracker } from "../../context-tracking/FileContextTracker"

// Mock the parseMentions function
vi.mock("../index", () => ({
	parseMentions: vi.fn(),
}))

describe("processUserContentMentions", () => {
	let mockUrlContentFetcher: UrlContentFetcher
	let mockFileContextTracker: FileContextTracker
	let mockRooIgnoreController: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockUrlContentFetcher = {} as UrlContentFetcher
		mockFileContextTracker = {} as FileContextTracker
		mockRooIgnoreController = {}

		// Default mock implementation - returns ParseMentionsResult object
		vi.mocked(parseMentions).mockImplementation(async (text) => ({
			text: `parsed: ${text}`,
			mode: undefined,
			contentBlocks: [],
		}))
	})

	describe("content processing", () => {
		it("should process text blocks with <user_message> tags", async () => {
			const userContent = [
				{
					type: "text" as const,
					text: "<user_message>Do something</user_message>",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).toHaveBeenCalled()
			expect(result.content[0]).toEqual({
				type: "text",
				text: "parsed: <user_message>Do something</user_message>",
			})
			expect(result.mode).toBeUndefined()
		})

		it("should not process text blocks without user_message tags", async () => {
			const userContent = [
				{
					type: "text" as const,
					text: "Regular text without special tags",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).not.toHaveBeenCalled()
			expect(result.content[0]).toEqual(userContent[0])
			expect(result.mode).toBeUndefined()
		})

		it("should process tool_result blocks with string content", async () => {
			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "123",
					content: "<user_message>Tool feedback</user_message>",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).toHaveBeenCalled()
			// String content is now converted to array format to support content blocks
			expect(result.content[0]).toEqual({
				type: "tool_result",
				tool_use_id: "123",
				content: [
					{
						type: "text",
						text: "parsed: <user_message>Tool feedback</user_message>",
					},
				],
			})
			expect(result.mode).toBeUndefined()
		})

		it("should process tool_result blocks with array content", async () => {
			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "123",
					content: [
						{
							type: "text" as const,
							text: "<user_message>Array task</user_message>",
						},
						{
							type: "text" as const,
							text: "Regular text",
						},
					],
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).toHaveBeenCalledTimes(1)
			expect(result.content[0]).toEqual({
				type: "tool_result",
				tool_use_id: "123",
				content: [
					{
						type: "text",
						text: "parsed: <user_message>Array task</user_message>",
					},
					{
						type: "text",
						text: "Regular text",
					},
				],
			})
			expect(result.mode).toBeUndefined()
		})

		it("should handle mixed content types", async () => {
			const userContent = [
				{
					type: "text" as const,
					text: "<user_message>First task</user_message>",
				},
				{
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: "image/png" as const,
						data: "base64data",
					},
				},
				{
					type: "tool_result" as const,
					tool_use_id: "456",
					content: "<user_message>Feedback</user_message>",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).toHaveBeenCalledTimes(2)
			expect(result.content).toHaveLength(3)
			expect(result.content[0]).toEqual({
				type: "text",
				text: "parsed: <user_message>First task</user_message>",
			})
			expect(result.content[1]).toEqual(userContent[1]) // Image block unchanged
			// String content is now converted to array format to support content blocks
			expect(result.content[2]).toEqual({
				type: "tool_result",
				tool_use_id: "456",
				content: [
					{
						type: "text",
						text: "parsed: <user_message>Feedback</user_message>",
					},
				],
			})
			expect(result.mode).toBeUndefined()
		})
	})

	describe("showRooIgnoredFiles parameter", () => {
		it("should default showRooIgnoredFiles to false", async () => {
			const userContent = [
				{
					type: "text" as const,
					text: "<user_message>Test default</user_message>",
				},
			]

			await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(parseMentions).toHaveBeenCalledWith(
				"<user_message>Test default</user_message>",
				"/test",
				mockUrlContentFetcher,
				mockFileContextTracker,
				undefined,
				false, // showRooIgnoredFiles should default to false
				true, // includeDiagnosticMessages
				50, // maxDiagnosticMessages
			)
		})

		it("should respect showRooIgnoredFiles when explicitly set to false", async () => {
			const userContent = [
				{
					type: "text" as const,
					text: "<user_message>Test explicit false</user_message>",
				},
			]

			await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
				showRooIgnoredFiles: false,
			})

			expect(parseMentions).toHaveBeenCalledWith(
				"<user_message>Test explicit false</user_message>",
				"/test",
				mockUrlContentFetcher,
				mockFileContextTracker,
				undefined,
				false,
				true, // includeDiagnosticMessages
				50, // maxDiagnosticMessages
			)
		})
	})

	describe("slash command content processing", () => {
		it("should separate slash command content into a new block", async () => {
			vi.mocked(parseMentions).mockResolvedValueOnce({
				text: "parsed text",
				slashCommandHelp: "command help",
				mode: undefined,
				contentBlocks: [],
			})

			const userContent = [
				{
					type: "text" as const,
					text: "<user_message>Run command</user_message>",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(result.content).toHaveLength(2)
			expect(result.content[0]).toEqual({
				type: "text",
				text: "parsed text",
			})
			expect(result.content[1]).toEqual({
				type: "text",
				text: "command help",
			})
		})

		it("should include slash command content in tool_result string content", async () => {
			vi.mocked(parseMentions).mockResolvedValueOnce({
				text: "parsed tool output",
				slashCommandHelp: "command help",
				mode: undefined,
				contentBlocks: [],
			})

			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "123",
					content: "<user_message>Tool output</user_message>",
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(result.content).toHaveLength(1)
			expect(result.content[0]).toEqual({
				type: "tool_result",
				tool_use_id: "123",
				content: [
					{
						type: "text",
						text: "parsed tool output",
					},
					{
						type: "text",
						text: "command help",
					},
				],
			})
		})

		it("should include slash command content in tool_result array content", async () => {
			vi.mocked(parseMentions).mockResolvedValueOnce({
				text: "parsed array item",
				slashCommandHelp: "command help",
				mode: undefined,
				contentBlocks: [],
			})

			const userContent = [
				{
					type: "tool_result" as const,
					tool_use_id: "123",
					content: [
						{
							type: "text" as const,
							text: "<user_message>Array item</user_message>",
						},
					],
				},
			]

			const result = await processUserContentMentions({
				userContent,
				cwd: "/test",
				urlContentFetcher: mockUrlContentFetcher,
				fileContextTracker: mockFileContextTracker,
			})

			expect(result.content).toHaveLength(1)
			expect(result.content[0]).toEqual({
				type: "tool_result",
				tool_use_id: "123",
				content: [
					{
						type: "text",
						text: "parsed array item",
					},
					{
						type: "text",
						text: "command help",
					},
				],
			})
		})
	})
})

// Mock AWS SDK credential providers
vi.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = vi.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

// Mock BedrockRuntimeClient and ConverseStreamCommand
const mockSend = vi.fn()

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	return {
		BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
			send: mockSend,
			config: { region: "us-east-1" },
		})),
		ConverseStreamCommand: vi.fn((params) => ({
			...params,
			input: params,
		})),
		ConverseCommand: vi.fn(),
	}
})

import { AwsBedrockHandler } from "../bedrock"
import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import type { ApiHandlerCreateMessageMetadata } from "../../index"

const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)

// Test tool definitions in OpenAI format
const testTools = [
	{
		type: "function" as const,
		function: {
			name: "read_file",
			description: "Read a file from the filesystem",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "The path to the file" },
				},
				required: ["path"],
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "write_file",
			description: "Write content to a file",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "The path to the file" },
					content: { type: "string", description: "The content to write" },
				},
				required: ["path", "content"],
			},
		},
	},
]

describe("AwsBedrockHandler Native Tool Calling", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		vi.clearAllMocks()

		// Create handler with a model that supports native tools
		handler = new AwsBedrockHandler({
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		})

		// Mock the stream response
		mockSend.mockResolvedValue({
			stream: [],
		})
	})

	describe("convertToolsForBedrock", () => {
		it("should convert OpenAI tools to Bedrock format", () => {
			// Access private method
			const convertToolsForBedrock = (handler as any).convertToolsForBedrock.bind(handler)

			const bedrockTools = convertToolsForBedrock(testTools)

			expect(bedrockTools).toHaveLength(2)

			// Check structure and key properties (normalizeToolSchema adds additionalProperties: false)
			const tool = bedrockTools[0]
			expect(tool.toolSpec.name).toBe("read_file")
			expect(tool.toolSpec.description).toBe("Read a file from the filesystem")
			expect(tool.toolSpec.inputSchema.json.type).toBe("object")
			expect(tool.toolSpec.inputSchema.json.properties.path.type).toBe("string")
			expect(tool.toolSpec.inputSchema.json.properties.path.description).toBe("The path to the file")
			expect(tool.toolSpec.inputSchema.json.required).toEqual(["path"])
			// normalizeToolSchema adds additionalProperties: false by default
			expect(tool.toolSpec.inputSchema.json.additionalProperties).toBe(false)
		})

		it("should transform type arrays to anyOf for JSON Schema 2020-12 compliance", () => {
			const convertToolsForBedrock = (handler as any).convertToolsForBedrock.bind(handler)

			// Tools with type: ["string", "null"] syntax (valid in draft-07 but not 2020-12)
			const toolsWithNullableTypes = [
				{
					type: "function" as const,
					function: {
						name: "execute_command",
						description: "Execute a command",
						parameters: {
							type: "object",
							properties: {
								command: { type: "string", description: "The command to execute" },
								cwd: {
									type: ["string", "null"],
									description: "Working directory (optional)",
								},
							},
							required: ["command", "cwd"],
						},
					},
				},
				{
					type: "function" as const,
					function: {
						name: "read_file",
						description: "Read files",
						parameters: {
							type: "object",
							properties: {
								files: {
									type: "array",
									items: {
										type: "object",
										properties: {
											path: { type: "string" },
											line_ranges: {
												type: ["array", "null"],
												items: { type: "integer" },
												description: "Optional line ranges",
											},
										},
										required: ["path", "line_ranges"],
									},
								},
							},
							required: ["files"],
						},
					},
				},
			]

			const bedrockTools = convertToolsForBedrock(toolsWithNullableTypes)

			expect(bedrockTools).toHaveLength(2)

			// First tool: cwd should be transformed from type: ["string", "null"] to anyOf
			const executeCommandSchema = bedrockTools[0].toolSpec.inputSchema.json as any
			expect(executeCommandSchema.properties.cwd.anyOf).toEqual([{ type: "string" }, { type: "null" }])
			expect(executeCommandSchema.properties.cwd.type).toBeUndefined()
			expect(executeCommandSchema.properties.cwd.description).toBe("Working directory (optional)")

			// Second tool: line_ranges should be transformed from type: ["array", "null"] to anyOf
			// with items moved inside the array variant (required by GPT-5-mini strict schema validation)
			const readFileSchema = bedrockTools[1].toolSpec.inputSchema.json as any
			const lineRanges = readFileSchema.properties.files.items.properties.line_ranges
			expect(lineRanges.anyOf).toEqual([{ type: "array", items: { type: "integer" } }, { type: "null" }])
			expect(lineRanges.type).toBeUndefined()
			// items should now be inside the array variant, not at root
			expect(lineRanges.items).toBeUndefined()
			expect(lineRanges.description).toBe("Optional line ranges")
		})

		it("should filter non-function tools", () => {
			const convertToolsForBedrock = (handler as any).convertToolsForBedrock.bind(handler)

			const mixedTools = [
				...testTools,
				{ type: "other" as any, something: {} }, // Should be filtered out
			]

			const bedrockTools = convertToolsForBedrock(mixedTools)

			expect(bedrockTools).toHaveLength(2)
		})
	})

	describe("convertToolChoiceForBedrock", () => {
		it("should convert 'auto' to Bedrock auto format", () => {
			const convertToolChoiceForBedrock = (handler as any).convertToolChoiceForBedrock.bind(handler)

			const result = convertToolChoiceForBedrock("auto")

			expect(result).toEqual({ auto: {} })
		})

		it("should convert 'required' to Bedrock any format", () => {
			const convertToolChoiceForBedrock = (handler as any).convertToolChoiceForBedrock.bind(handler)

			const result = convertToolChoiceForBedrock("required")

			expect(result).toEqual({ any: {} })
		})

		it("should return undefined for 'none'", () => {
			const convertToolChoiceForBedrock = (handler as any).convertToolChoiceForBedrock.bind(handler)

			const result = convertToolChoiceForBedrock("none")

			expect(result).toBeUndefined()
		})

		it("should convert specific tool choice to Bedrock tool format", () => {
			const convertToolChoiceForBedrock = (handler as any).convertToolChoiceForBedrock.bind(handler)

			const result = convertToolChoiceForBedrock({
				type: "function",
				function: { name: "read_file" },
			})

			expect(result).toEqual({
				tool: {
					name: "read_file",
				},
			})
		})

		it("should default to auto for undefined toolChoice", () => {
			const convertToolChoiceForBedrock = (handler as any).convertToolChoiceForBedrock.bind(handler)

			const result = convertToolChoiceForBedrock(undefined)

			expect(result).toEqual({ auto: {} })
		})
	})

	describe("createMessage with native tools", () => {
		it("should include toolConfig when tools are provided with native protocol", async () => {
			// Override model info to support native tools
			const modelInfo = handler.getModel().info
			;(modelInfo as any).supportsNativeTools = true

			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Manually set supportsNativeTools
			const getModelOriginal = handlerWithNativeTools.getModel.bind(handlerWithNativeTools)
			handlerWithNativeTools.getModel = () => {
				const model = getModelOriginal()
				model.info.supportsNativeTools = true
				return model
			}

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				tools: testTools,
				toolProtocol: "native",
			}

			const generator = handlerWithNativeTools.createMessage(
				"You are a helpful assistant.",
				[{ role: "user", content: "Read the file at /test.txt" }],
				metadata,
			)

			await generator.next()

			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			expect(commandArg.toolConfig).toBeDefined()
			expect(commandArg.toolConfig.tools).toHaveLength(2)
			expect(commandArg.toolConfig.tools[0].toolSpec.name).toBe("read_file")
			expect(commandArg.toolConfig.toolChoice).toEqual({ auto: {} })
		})

		it("should not include toolConfig when toolProtocol is xml", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Manually set supportsNativeTools
			const getModelOriginal = handlerWithNativeTools.getModel.bind(handlerWithNativeTools)
			handlerWithNativeTools.getModel = () => {
				const model = getModelOriginal()
				model.info.supportsNativeTools = true
				return model
			}

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				tools: testTools,
				toolProtocol: "xml", // XML protocol should not use native tools
			}

			const generator = handlerWithNativeTools.createMessage(
				"You are a helpful assistant.",
				[{ role: "user", content: "Read the file at /test.txt" }],
				metadata,
			)

			await generator.next()

			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			expect(commandArg.toolConfig).toBeUndefined()
		})

		it("should not include toolConfig when tool_choice is none", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Manually set supportsNativeTools
			const getModelOriginal = handlerWithNativeTools.getModel.bind(handlerWithNativeTools)
			handlerWithNativeTools.getModel = () => {
				const model = getModelOriginal()
				model.info.supportsNativeTools = true
				return model
			}

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				tools: testTools,
				toolProtocol: "native",
				tool_choice: "none", // Explicitly disable tool use
			}

			const generator = handlerWithNativeTools.createMessage(
				"You are a helpful assistant.",
				[{ role: "user", content: "Read the file at /test.txt" }],
				metadata,
			)

			await generator.next()

			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			expect(commandArg.toolConfig).toBeUndefined()
		})

		it("should include fine-grained tool streaming beta for Claude models with native tools", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Manually set supportsNativeTools
			const getModelOriginal = handlerWithNativeTools.getModel.bind(handlerWithNativeTools)
			handlerWithNativeTools.getModel = () => {
				const model = getModelOriginal()
				model.info.supportsNativeTools = true
				return model
			}

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				tools: testTools,
				toolProtocol: "native",
			}

			const generator = handlerWithNativeTools.createMessage(
				"You are a helpful assistant.",
				[{ role: "user", content: "Read the file at /test.txt" }],
				metadata,
			)

			await generator.next()

			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			// Should include the fine-grained tool streaming beta
			expect(commandArg.additionalModelRequestFields).toBeDefined()
			expect(commandArg.additionalModelRequestFields.anthropic_beta).toContain(
				"fine-grained-tool-streaming-2025-05-14",
			)
		})

		it("should not include fine-grained tool streaming beta when not using native tools", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				// No tools provided
			}

			const generator = handlerWithNativeTools.createMessage(
				"You are a helpful assistant.",
				[{ role: "user", content: "Hello" }],
				metadata,
			)

			await generator.next()

			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			// Should not include anthropic_beta when not using native tools
			if (commandArg.additionalModelRequestFields?.anthropic_beta) {
				expect(commandArg.additionalModelRequestFields.anthropic_beta).not.toContain(
					"fine-grained-tool-streaming-2025-05-14",
				)
			}
		})
	})

	describe("tool call streaming events", () => {
		it("should yield tool_call_partial for toolUse block start", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Mock stream with tool use events
			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield {
						contentBlockStart: {
							contentBlockIndex: 0,
							start: {
								toolUse: {
									toolUseId: "tool-123",
									name: "read_file",
								},
							},
						},
					}
					yield {
						contentBlockDelta: {
							contentBlockIndex: 0,
							delta: {
								toolUse: {
									input: '{"path": "/test.txt"}',
								},
							},
						},
					}
					yield {
						metadata: {
							usage: {
								inputTokens: 100,
								outputTokens: 50,
							},
						},
					}
				})(),
			})

			const generator = handlerWithNativeTools.createMessage("You are a helpful assistant.", [
				{ role: "user", content: "Read the file" },
			])

			const results: any[] = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Should have tool_call_partial chunks
			const toolCallChunks = results.filter((r) => r.type === "tool_call_partial")
			expect(toolCallChunks).toHaveLength(2)

			// First chunk should have id and name
			expect(toolCallChunks[0]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "tool-123",
				name: "read_file",
				arguments: undefined,
			})

			// Second chunk should have arguments
			expect(toolCallChunks[1]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '{"path": "/test.txt"}',
			})
		})

		it("should yield tool_call_partial for contentBlock toolUse structure", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Mock stream with alternative tool use structure
			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield {
						contentBlockStart: {
							contentBlockIndex: 0,
							contentBlock: {
								toolUse: {
									toolUseId: "tool-456",
									name: "write_file",
								},
							},
						},
					}
					yield {
						metadata: {
							usage: {
								inputTokens: 100,
								outputTokens: 50,
							},
						},
					}
				})(),
			})

			const generator = handlerWithNativeTools.createMessage("You are a helpful assistant.", [
				{ role: "user", content: "Write a file" },
			])

			const results: any[] = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Should have tool_call_partial chunk
			const toolCallChunks = results.filter((r) => r.type === "tool_call_partial")
			expect(toolCallChunks).toHaveLength(1)

			expect(toolCallChunks[0]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "tool-456",
				name: "write_file",
				arguments: undefined,
			})
		})

		it("should handle mixed text and tool use content", async () => {
			const handlerWithNativeTools = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Mock stream with mixed content
			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield {
						contentBlockStart: {
							contentBlockIndex: 0,
							start: {
								text: "Let me read that file for you.",
							},
						},
					}
					yield {
						contentBlockDelta: {
							contentBlockIndex: 0,
							delta: {
								text: " Here's what I found:",
							},
						},
					}
					yield {
						contentBlockStart: {
							contentBlockIndex: 1,
							start: {
								toolUse: {
									toolUseId: "tool-789",
									name: "read_file",
								},
							},
						},
					}
					yield {
						contentBlockDelta: {
							contentBlockIndex: 1,
							delta: {
								toolUse: {
									input: '{"path": "/example.txt"}',
								},
							},
						},
					}
					yield {
						metadata: {
							usage: {
								inputTokens: 150,
								outputTokens: 75,
							},
						},
					}
				})(),
			})

			const generator = handlerWithNativeTools.createMessage("You are a helpful assistant.", [
				{ role: "user", content: "Read the example file" },
			])

			const results: any[] = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Should have text chunks
			const textChunks = results.filter((r) => r.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Let me read that file for you.")
			expect(textChunks[1].text).toBe(" Here's what I found:")

			// Should have tool call chunks
			const toolCallChunks = results.filter((r) => r.type === "tool_call_partial")
			expect(toolCallChunks).toHaveLength(2)
			expect(toolCallChunks[0].name).toBe("read_file")
			expect(toolCallChunks[1].arguments).toBe('{"path": "/example.txt"}')
		})
	})
})

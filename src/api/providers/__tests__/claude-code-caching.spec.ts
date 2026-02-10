import { ClaudeCodeHandler } from "../claude-code"
import type { ApiHandlerOptions } from "../../../shared/api"
import type { StreamChunk } from "../../../integrations/claude-code/streaming-client"
import type { ApiStreamUsageChunk } from "../../transform/stream"

// Mock the OAuth manager
vi.mock("../../../integrations/claude-code/oauth", () => ({
	claudeCodeOAuthManager: {
		getAccessToken: vi.fn(),
		getEmail: vi.fn(),
		loadCredentials: vi.fn(),
		saveCredentials: vi.fn(),
		clearCredentials: vi.fn(),
		isAuthenticated: vi.fn(),
	},
	generateUserId: vi.fn(() => "user_abc123_account_def456_session_ghi789"),
}))

// Mock the streaming client
vi.mock("../../../integrations/claude-code/streaming-client", () => ({
	createStreamingMessage: vi.fn(),
}))

const { claudeCodeOAuthManager } = await import("../../../integrations/claude-code/oauth")
const { createStreamingMessage } = await import("../../../integrations/claude-code/streaming-client")

const mockGetAccessToken = vi.mocked(claudeCodeOAuthManager.getAccessToken)
const mockCreateStreamingMessage = vi.mocked(createStreamingMessage)

describe("ClaudeCodeHandler - Caching Support", () => {
	let handler: ClaudeCodeHandler
	const mockOptions: ApiHandlerOptions = {
		apiModelId: "claude-sonnet-4-5",
	}

	beforeEach(() => {
		handler = new ClaudeCodeHandler(mockOptions)
		vi.clearAllMocks()
		mockGetAccessToken.mockResolvedValue("test-access-token")
	})

	it("should collect cache read tokens from API response", async () => {
		const mockStream = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello!" }
			yield {
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 80,
				cacheWriteTokens: 20,
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// Find the usage chunk
		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.inputTokens).toBe(100)
		expect(usageChunk!.outputTokens).toBe(50)
		expect(usageChunk!.cacheReadTokens).toBe(80)
		expect(usageChunk!.cacheWriteTokens).toBe(20)
	})

	it("should accumulate cache tokens across multiple messages", async () => {
		// Note: The streaming client handles accumulation internally.
		// Each usage chunk represents the accumulated totals for that point in the stream.
		// This test verifies that we correctly pass through the accumulated values.
		const mockStream = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Part 1" }
			yield {
				type: "usage",
				inputTokens: 50,
				outputTokens: 25,
				cacheReadTokens: 40,
				cacheWriteTokens: 10,
			}
			yield { type: "text", text: "Part 2" }
			yield {
				type: "usage",
				inputTokens: 100, // Accumulated: 50 + 50
				outputTokens: 50, // Accumulated: 25 + 25
				cacheReadTokens: 70, // Accumulated: 40 + 30
				cacheWriteTokens: 30, // Accumulated: 10 + 20
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// Get the last usage chunk which should have accumulated totals
		const usageChunks = chunks.filter((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk[]
		expect(usageChunks.length).toBe(2)

		const lastUsageChunk = usageChunks[usageChunks.length - 1]
		expect(lastUsageChunk.inputTokens).toBe(100) // 50 + 50
		expect(lastUsageChunk.outputTokens).toBe(50) // 25 + 25
		expect(lastUsageChunk.cacheReadTokens).toBe(70) // 40 + 30
		expect(lastUsageChunk.cacheWriteTokens).toBe(30) // 10 + 20
	})

	it("should handle missing cache token fields gracefully", async () => {
		const mockStream = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello!" }
			yield {
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				// No cache tokens provided
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.inputTokens).toBe(100)
		expect(usageChunk!.outputTokens).toBe(50)
		expect(usageChunk!.cacheReadTokens).toBeUndefined()
		expect(usageChunk!.cacheWriteTokens).toBeUndefined()
	})

	it("should report zero cost for subscription usage", async () => {
		// Claude Code is always subscription-based, cost should always be 0
		const mockStream = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello!" }
			yield {
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 80,
				cacheWriteTokens: 20,
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.totalCost).toBe(0) // Should always be 0 for Claude Code (subscription-based)
	})
})

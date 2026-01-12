import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { SlackIntegrationService } from "./slack-service"
import { getDatabaseManager } from "../../core/database/manager"
import type { ExtensionContext } from "vscode"

// Mock the Slack web API
const mockSlackWebClient = {
	chat: {
		postMessage: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
	auth: {
		test: vi.fn(),
	},
}

vi.mock("@slack/web-api", () => ({
	WebClient: vi.fn(() => mockSlackWebClient),
}))

// Mock DatabaseManager
vi.mock("../../core/database/manager", () => ({
	getDatabaseManager: vi.fn(),
}))

// Mock VSCode secrets
const mockSecretsGet = vi.fn<() => Promise<string | undefined>>().mockResolvedValue("xoxb-test-bot-token")
const mockSecrets = {
	get: mockSecretsGet,
	store: vi.fn(),
	delete: vi.fn(),
}

const mockContext = {
	secrets: mockSecrets,
} as unknown as ExtensionContext

describe("SlackIntegrationService - Message Sharing", () => {
	let service: SlackIntegrationService
	let mockDb: any

	beforeEach(() => {
		// Mock database manager
		mockDb = {
			createSlackIntegration: vi.fn(() => "integration-id-123"),
			getSlackIntegration: vi.fn(() => null),
			createSharedMessage: vi.fn(),
			getSharedMessagesByIntegrationId: vi.fn(() => []),
			updateSlackIntegrationLastUsed: vi.fn(),
			updateSlackIntegrationActive: vi.fn(),
			deleteSlackIntegration: vi.fn(),
			deleteSharedMessagesByIntegrationId: vi.fn(),
		}
		vi.mocked(getDatabaseManager).mockReturnValue(mockDb)

		service = new SlackIntegrationService(mockContext)
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("should share formatted code block to Slack", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "test-integration-id",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "#general",
			bot_token: "",
			user_token: "",
			is_active: 1,
			created_at: new Date().toISOString(),
			last_used: new Date().toISOString(),
			metadata: null,
		})

		// Mock bot token retrieval from secrets
		vi.mocked(mockContext.secrets.get).mockResolvedValue("xoxb-test-bot-token")

		mockSlackWebClient.chat.postMessage.mockResolvedValue({
			ok: true,
			ts: "1234567890.123456",
			channel: "C12345",
		})

		const codeSnippet = `function test() {
  return 'Hello World';
}`

		const result = await service.shareMessage({
			integrationId: "test-integration-id",
			content: codeSnippet,
			channelId: "#general",
			messageType: "code",
		})

		expect(result.success).toBe(true)
		expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
			channel: "#general",
			text: `\`\`\`${codeSnippet}\`\`\``,
			mrkdwn: true,
		})
	})

	test("should share plain text message to Slack", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "test-integration-id",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "#dev-team",
			bot_token: "",
			user_token: "",
			is_active: 1,
			created_at: new Date().toISOString(),
			last_used: new Date().toISOString(),
			metadata: null,
		})

		// Mock bot token retrieval from secrets
		vi.mocked(mockContext.secrets.get).mockResolvedValue("xoxb-test-bot-token")

		mockSlackWebClient.chat.postMessage.mockResolvedValue({
			ok: true,
			ts: "1234567890.123456",
			channel: "C12345",
		})

		const textMessage = "Check out this analysis"

		const result = await service.shareMessage({
			integrationId: "test-integration-id",
			content: textMessage,
			channelId: "#dev-team",
			messageType: "text",
		})

		expect(result.success).toBe(true)
		expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
			channel: "#dev-team",
			text: textMessage,
			mrkdwn: true,
		})
	})

	test("should fail sharing when integration not found", async () => {
		const result = await service.shareMessage({
			integrationId: "non-existent-id",
			content: "Test message",
			channelId: "#general",
		})

		expect(result.success).toBe(false)
		expect(result.error).toBe("Integration not found")
	})

	test("should fail sharing when bot token missing", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "test-integration-id",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "#general",
			bot_token: "",
			user_token: "",
			is_active: 1,
			created_at: new Date().toISOString(),
			last_used: new Date().toISOString(),
			metadata: null,
		})

		vi.mocked(mockContext.secrets.get).mockResolvedValue(undefined)

		const result = await service.shareMessage({
			integrationId: "test-integration-id",
			content: "Test message",
			channelId: "#general",
		})

		expect(result.success).toBe(false)
		expect(result.error).toBe("Bot token not found")
	})

	test("should handle Slack API errors gracefully", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "test-integration-id",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "#invalid-channel",
			bot_token: "",
			user_token: "",
			is_active: 1,
			created_at: new Date().toISOString(),
			last_used: new Date().toISOString(),
			metadata: null,
		})

		vi.mocked(mockContext.secrets.get).mockResolvedValue("test-bot-token")
		mockSlackWebClient.chat.postMessage.mockResolvedValue({
			ok: false,
			error: "channel_not_found",
		})

		const result = await service.shareMessage({
			integrationId: "test-integration-id",
			content: "Test message",
			channelId: "#invalid-channel",
		})

		expect(result.success).toBe(false)
		expect(result.error).toBe("channel_not_found")
	})

	test("should format code snippets correctly", () => {
		const code = "const x = 10;"
		const formatted = service.formatCodeSnippet(code, "typescript")

		expect(formatted).toBe("```typescript\nconst x = 10;```")
	})

	test("should format code snippets with default language", () => {
		const code = 'print("Hello")'
		const formatted = service.formatCodeSnippet(code)

		expect(formatted).toBe('```text\nprint("Hello")```')
	})
})

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { SlackIntegrationService } from "./slack-service"
import { getDatabaseManager } from "../../core/database/manager"
import type { ExtensionContext } from "vscode"

// Mock the Slack web API
const mockSlackWebClient = {
	chat: {
		postMessage: vi.fn(),
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

describe("SlackIntegrationService", () => {
	let service: SlackIntegrationService
	let mockDb: any
	let mockContext: ExtensionContext

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

		// Mock VSCode ExtensionContext with properly typed mocks
		const mockSecretsGet = vi.fn<() => Promise<string | undefined>>().mockResolvedValue("xoxb-test-bot-token")
		mockContext = {
			secrets: {
				get: mockSecretsGet,
				store: vi.fn(),
				delete: vi.fn(),
			},
		} as unknown as ExtensionContext

		service = new SlackIntegrationService(mockContext)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("should create slack integration successfully", async () => {
		const integrationData = {
			userId: "user123",
			workspaceId: "workspace123",
			channelId: "channel123",
			botToken: "xoxb-test-token",
			userToken: "xoxp-test-token",
			isActive: true,
		}

		const integration = await service.createIntegration(integrationData)

		expect(integration).toBeDefined()
		expect(integration.userId).toBe("user123")
		expect(integration.workspaceId).toBe("workspace123")
		expect(integration.isActive).toBe(true)
	})

	test("should authenticate with valid tokens", async () => {
		mockSlackWebClient.auth.test.mockResolvedValue({
			ok: true,
			team: "test-team",
			user: "test-user",
		})

		const isValid = await service.validateToken("xoxb-test-token")

		expect(isValid).toBe(true)
		expect(mockSlackWebClient.auth.test).toHaveBeenCalledWith()
	})

	test("should fail authentication with invalid tokens", async () => {
		mockSlackWebClient.auth.test.mockResolvedValue({
			ok: false,
			error: "invalid_auth",
		})

		const isValid = await service.validateToken("invalid-token")

		expect(isValid).toBe(false)
	})

	test("should share message to Slack successfully", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "integration123",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "channel123",
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
			ts: "message-timestamp",
			channel: "channel123",
		})

		const messageData = {
			integrationId: "integration123",
			content: "Hello from Kilo Code!",
			channelId: "channel123",
		}

		const result = await service.shareMessage(messageData)

		expect(result).toBeDefined()
		expect(result.success).toBe(true)
		expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
			channel: "channel123",
			text: "Hello from Kilo Code!",
			mrkdwn: true,
		})
	})

	test("should format code snippets for Slack", () => {
		const code = `function hello() {
  console.log('Hello World')
}`
		const formatted = service.formatCodeSnippet(code, "javascript")

		expect(formatted).toContain("```javascript")
		expect(formatted).toContain("function hello()")
		expect(formatted).toContain("console.log('Hello World')")
		expect(formatted).toContain("```")
	})

	test("should handle sharing failure gracefully", async () => {
		// Mock integration retrieval
		mockDb.getSlackIntegration.mockReturnValue({
			id: "integration123",
			user_id: "user123",
			workspace_id: "workspace123",
			channel_id: "channel123",
			bot_token: "",
			user_token: "",
			is_active: 1,
			created_at: new Date().toISOString(),
			last_used: new Date().toISOString(),
			metadata: null,
		})

		// Mock bot token retrieval from secrets
		vi.mocked(mockContext.secrets.get).mockResolvedValue("xoxb-test-bot-token")

		mockSlackWebClient.chat.postMessage.mockRejectedValue(new Error("Failed to post message"))

		const messageData = {
			integrationId: "integration123",
			content: "Test message",
			channelId: "channel123",
		}

		const result = await service.shareMessage(messageData)

		expect(result).toBeDefined()
		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
	})
})

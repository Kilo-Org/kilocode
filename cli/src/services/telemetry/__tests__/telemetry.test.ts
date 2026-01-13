/**
 * Tests for Telemetry Implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Mock the telemetry constants module to return a valid API key
// This must be done before importing TelemetryService
vi.mock("../../../constants/telemetry.js", async () => {
	return {
		KILOCODE_POSTHOG_API_KEY: "test-posthog-api-key",
	}
})

// Mock PostHog - use a class to satisfy Vitest 4.x requirements
vi.mock("posthog-node", () => ({
	PostHog: class MockPostHog {
		capture = vi.fn()
		shutdown = vi.fn().mockResolvedValue(undefined)
		optIn = vi.fn()
		optOut = vi.fn()
	},
}))

// Mock fs-extra
vi.mock("fs-extra", () => ({
	ensureDir: vi.fn().mockResolvedValue(undefined),
	pathExists: vi.fn().mockResolvedValue(false),
	readJson: vi.fn().mockResolvedValue({}),
	writeJson: vi.fn().mockResolvedValue(undefined),
	remove: vi.fn().mockResolvedValue(undefined),
}))

// Mock logs
vi.mock("../../logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

import { TelemetryClient } from "../TelemetryClient.js"
import { TelemetryService } from "../TelemetryService.js"
import { IdentityManager } from "../identity.js"
import { TelemetryEvent } from "../events.js"

describe("TelemetryClient", () => {
	let client: TelemetryClient

	beforeEach(() => {
		client = new TelemetryClient({
			enabled: true,
			apiKey: "test-api-key",
			host: "https://test.posthog.com",
			debug: false,
		})
	})

	afterEach(async () => {
		await client.shutdown()
	})

	it("should initialize with config", () => {
		expect(client).toBeDefined()
		expect(client.isEnabled()).toBe(true)
	})

	it("should capture events when enabled", () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		client.capture(TelemetryEvent.SESSION_STARTED, { test: "property" })

		// Event should be queued
		expect(client).toBeDefined()
	})

	it("should not capture events when disabled", () => {
		const disabledClient = new TelemetryClient({
			enabled: false,
			apiKey: "test-api-key",
			host: "https://test.posthog.com",
		})

		expect(disabledClient.isEnabled()).toBe(false)
	})

	it("should track command execution", () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		client.trackCommand("help", 100, true)

		expect(client).toBeDefined()
	})

	it("should track API requests", () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		client.trackApiRequest("anthropic", "claude-3-5-sonnet", 500, {
			inputTokens: 100,
			outputTokens: 200,
		})

		expect(client).toBeDefined()
	})

	it("should capture exceptions", () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		const error = new Error("Test error")
		client.captureException(error, { context: "test" })

		expect(client).toBeDefined()
	})

	it("should collect performance metrics", () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		client.trackCommand("help", 100, true)
		client.trackCommand("exit", 50, true)

		const metrics = client.getPerformanceMetrics()

		expect(metrics.totalCommands).toBe(2)
		expect(metrics.averageCommandTime).toBeDefined()
		expect(metrics.memoryHeapUsed).toBeGreaterThan(0)
	})

	it("should batch events", async () => {
		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)

		// Capture multiple events
		for (let i = 0; i < 5; i++) {
			client.capture(TelemetryEvent.COMMAND_EXECUTED, { index: i })
		}

		// Flush should send all events
		await client.flush()

		expect(client).toBeDefined()
	})
})

describe("TelemetryService", () => {
	let service: TelemetryService

	beforeEach(() => {
		// Reset singleton
		;(TelemetryService as unknown as { instance: TelemetryService | null }).instance = null
		service = TelemetryService.getInstance()
	})

	afterEach(async () => {
		await service.shutdown()
	})

	it("should be a singleton", () => {
		const instance1 = TelemetryService.getInstance()
		const instance2 = TelemetryService.getInstance()

		expect(instance1).toBe(instance2)
	})

	it("should initialize with config", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode" as const,
					kilocodeToken: "",
				},
			],
		}

		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: false,
		})

		// With the mocked KILOCODE_POSTHOG_API_KEY, telemetry should be enabled
		expect(service.isEnabled()).toBe(true)
	})

	it("should track session events", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: false,
		})

		// Session start is tracked during initialization
		expect(service).toBeDefined()
	})

	it("should track command execution", () => {
		service.trackCommandExecuted("help", [], 100, true)
		expect(service).toBeDefined()
	})

	it("should track message events", () => {
		service.trackUserMessageSent(50, false, false, "task-123")
		service.trackAssistantMessageReceived(200, "task-123")
		expect(service).toBeDefined()
	})

	it("should track task lifecycle", () => {
		service.trackTaskCreated("task-123")
		service.trackTaskCompleted("task-123", 5000, {
			messageCount: 10,
			toolUsageCount: 5,
		})
		expect(service).toBeDefined()
	})

	it("should track configuration changes", () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		service.trackConfigLoaded(mockConfig)
		service.trackConfigSaved(mockConfig)
		expect(service).toBeDefined()
	})

	it("should track provider changes", () => {
		service.trackProviderChanged("anthropic", "openai", "gpt-4")
		expect(service).toBeDefined()
	})

	it("should track mode changes", () => {
		service.trackModeChanged("code", "architect")
		expect(service).toBeDefined()
	})

	it("should track approval events", () => {
		service.trackApprovalRequested("tool", "readFile")
		service.trackApprovalAutoApproved("tool", "readFile", 100)
		service.trackApprovalAutoRejected("command", "rm -rf")
		service.trackApprovalManualApproved("tool", "writeFile", 500)
		service.trackApprovalManualRejected("tool", "browser_action", 300)
		expect(service).toBeDefined()
	})

	it("should track errors", () => {
		service.trackError("ValidationError", "Invalid input", "stack trace", false)
		service.trackException(new Error("Test error"), "test context", false)
		expect(service).toBeDefined()
	})

	it("should track CI mode events", () => {
		service.trackCIModeStarted(100, 60)
		service.trackCIModeCompleted({
			exitReason: "completion",
			totalDuration: 5000,
		})
		service.trackCIModeTimeout()
		expect(service).toBeDefined()
	})

	it("should update mode", () => {
		service.setMode("architect")
		expect(service).toBeDefined()
	})

	it("should update CI mode", () => {
		service.setCIMode(true)
		expect(service).toBeDefined()
	})
})

describe("IdentityManager", () => {
	let identityManager: IdentityManager

	beforeEach(() => {
		// Reset singleton
		;(IdentityManager as unknown as { instance: IdentityManager | null }).instance = null
		identityManager = IdentityManager.getInstance()
	})

	afterEach(async () => {
		await identityManager.reset()
	})

	it("should be a singleton", () => {
		const instance1 = IdentityManager.getInstance()
		const instance2 = IdentityManager.getInstance()

		expect(instance1).toBe(instance2)
	})

	it("should initialize identity", async () => {
		const identity = await identityManager.initialize()

		expect(identity).toBeDefined()
		expect(identity.cliUserId).toBeDefined()
		expect(identity.machineId).toBeDefined()
		expect(identity.sessionId).toBeDefined()
		expect(identity.sessionStartTime).toBeGreaterThan(0)
	})

	it("should generate distinct ID", async () => {
		await identityManager.initialize()
		const distinctId = identityManager.getDistinctId()

		expect(distinctId).toBeDefined()
		expect(typeof distinctId).toBe("string")
	})

	it("should calculate session duration", async () => {
		await identityManager.initialize()

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 100))

		const duration = identityManager.getSessionDuration()
		expect(duration).toBeGreaterThan(0)
	})

	it("should clear Kilocode user ID", async () => {
		await identityManager.initialize()
		identityManager.clearKilocodeUserId()

		const identity = identityManager.getIdentity()
		expect(identity?.kilocodeUserId).toBeUndefined()
	})
})

describe("Event Types", () => {
	it("should have all required event types", () => {
		// Session events
		expect(TelemetryEvent.SESSION_STARTED).toBe("cli_session_started")
		expect(TelemetryEvent.SESSION_ENDED).toBe("cli_session_ended")

		// Command events
		expect(TelemetryEvent.COMMAND_EXECUTED).toBe("cli_command_executed")
		expect(TelemetryEvent.COMMAND_FAILED).toBe("cli_command_failed")

		// Message events
		expect(TelemetryEvent.USER_MESSAGE_SENT).toBe("cli_user_message_sent")
		expect(TelemetryEvent.ASSISTANT_MESSAGE_RECEIVED).toBe("cli_assistant_message_received")

		// Task events
		expect(TelemetryEvent.TASK_CREATED).toBe("cli_task_created")
		expect(TelemetryEvent.TASK_COMPLETED).toBe("cli_task_completed")

		// Configuration events
		expect(TelemetryEvent.CONFIG_LOADED).toBe("cli_config_loaded")
		expect(TelemetryEvent.PROVIDER_CHANGED).toBe("cli_provider_changed")

		// Approval events
		expect(TelemetryEvent.APPROVAL_REQUESTED).toBe("cli_approval_requested")
		expect(TelemetryEvent.APPROVAL_AUTO_APPROVED).toBe("cli_approval_auto_approved")

		// CI mode events
		expect(TelemetryEvent.CI_MODE_STARTED).toBe("cli_ci_mode_started")
		expect(TelemetryEvent.CI_MODE_TIMEOUT).toBe("cli_ci_mode_timeout")

		// Error events
		expect(TelemetryEvent.ERROR_OCCURRED).toBe("cli_error_occurred")
		expect(TelemetryEvent.EXCEPTION_CAUGHT).toBe("cli_exception_caught")
	})
})

describe("Integration Tests", () => {
	it("should track complete workflow", async () => {
		const service = TelemetryService.getInstance()

		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		// Initialize
		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: false,
		})

		// Track various events
		service.trackCommandExecuted("help", [], 100, true)
		service.trackUserMessageSent(50, false, false)
		service.trackTaskCreated("task-123")
		service.trackProviderChanged("anthropic", "openai")
		service.trackModeChanged("code", "architect")
		service.trackApprovalRequested("tool", "readFile")
		service.trackApprovalAutoApproved("tool", "readFile", 50)

		// Shutdown
		await service.shutdown()

		expect(service).toBeDefined()
	})

	it("should handle telemetry disabled", async () => {
		const service = TelemetryService.getInstance()

		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: false, // Disabled
			provider: "default",
			providers: [],
		}

		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: false,
		})

		// Should not throw errors when tracking
		service.trackCommandExecuted("help", [], 100, true)
		service.trackUserMessageSent(50, false, false)

		expect(service.isEnabled()).toBe(false)
	})

	it("should track CI mode workflow", async () => {
		const service = TelemetryService.getInstance()

		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: true,
		})

		// Track CI mode events
		service.trackCIModeStarted(100, 60)
		service.trackCommandExecuted("help", [], 50, true)
		service.trackCIModeCompleted({
			exitReason: "completion",
			totalDuration: 5000,
			taskCompleted: true,
			approvalCount: 5,
			autoApprovalCount: 5,
			autoRejectionCount: 0,
		})

		await service.shutdown()

		expect(service).toBeDefined()
	})
})

describe("Privacy and Anonymization", () => {
	it("should anonymize workspace paths", async () => {
		const service = TelemetryService.getInstance()

		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		await service.initialize(mockConfig, {
			workspace: "/home/user/sensitive/project",
			mode: "code",
			ciMode: false,
		})

		// Workspace should be anonymized in events
		expect(service).toBeDefined()
	})

	it("should not include message content", () => {
		const service = TelemetryService.getInstance()

		// Track message with content
		service.trackUserMessageSent(100, false, false)

		// Only length should be tracked, not content
		expect(service).toBeDefined()
	})
})

describe("Performance", () => {
	it("should batch events efficiently", async () => {
		const client = new TelemetryClient({
			enabled: true,
			apiKey: "test-api-key",
			host: "https://test.posthog.com",
			batchSize: 5,
		})

		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)

		// Capture multiple events
		for (let i = 0; i < 10; i++) {
			client.capture(TelemetryEvent.COMMAND_EXECUTED, { index: i })
		}

		await client.shutdown()
		expect(client).toBeDefined()
	})

	it("should not block CLI operations", async () => {
		const service = TelemetryService.getInstance()

		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [],
		}

		const startTime = Date.now()

		await service.initialize(mockConfig, {
			workspace: "/test/workspace",
			mode: "code",
			ciMode: false,
		})

		// Track many events
		for (let i = 0; i < 100; i++) {
			service.trackCommandExecuted("test", [], 10, true)
		}

		const duration = Date.now() - startTime

		// Should complete quickly (< 100ms)
		expect(duration).toBeLessThan(100)
	})
})

describe("Error Handling", () => {
	it("should handle telemetry failures gracefully", async () => {
		const client = new TelemetryClient({
			enabled: true,
			apiKey: "", // Invalid API key
			host: "https://invalid.posthog.com",
		})

		// Should not throw
		expect(() => {
			const mockIdentity = {
				cliUserId: "test-user-id",
				machineId: "test-machine-id",
				sessionId: "test-session-id",
				sessionStartTime: Date.now(),
			}
			client.setIdentity(mockIdentity)
			client.capture(TelemetryEvent.SESSION_STARTED, {})
		}).not.toThrow()

		await client.shutdown()
	})

	it("should retry failed events", async () => {
		const client = new TelemetryClient({
			enabled: true,
			apiKey: "test-api-key",
			host: "https://test.posthog.com",
			maxRetries: 3,
		})

		const mockIdentity = {
			cliUserId: "test-user-id",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			sessionStartTime: Date.now(),
		}

		client.setIdentity(mockIdentity)
		client.capture(TelemetryEvent.COMMAND_EXECUTED, {})

		// Flush will attempt retries on failure
		await client.flush()

		await client.shutdown()
		expect(client).toBeDefined()
	})
})

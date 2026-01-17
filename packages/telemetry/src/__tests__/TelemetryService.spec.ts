// kilocode_change - new file
// pnpm --filter @roo-code/telemetry test src/__tests__/TelemetryService.spec.ts

import { TelemetryEventName, type TelemetryClient, type TelemetryPropertiesProvider } from "@roo-code/types"
import { TelemetryService } from "../TelemetryService"

describe("TelemetryService", () => {
	let mockClient: TelemetryClient
	let service: TelemetryService

	beforeEach(() => {
		// Reset the singleton instance before each test
		// @ts-expect-error - Accessing private static property for testing
		TelemetryService._instance = null

		mockClient = {
			setProvider: vi.fn(),
			capture: vi.fn().mockResolvedValue(undefined),
			captureException: vi.fn(),
			updateIdentity: vi.fn().mockResolvedValue(undefined),
			updateTelemetryState: vi.fn(),
			isTelemetryEnabled: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		}

		service = TelemetryService.createInstance([mockClient])
	})

	afterEach(() => {
		// Reset the singleton instance after each test
		// @ts-expect-error - Accessing private static property for testing
		TelemetryService._instance = null
	})

	describe("captureLlmCompletion", () => {
		it("should capture LLM completion event with basic properties", () => {
			const taskId = "test-task-123"
			const properties = {
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 10,
				cacheReadTokens: 5,
			}

			service.captureLlmCompletion(taskId, properties)

			expect(mockClient.capture).toHaveBeenCalledWith({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: {
					taskId,
					...properties,
				},
			})
		})

		it("should capture LLM completion event with all Phase 1a properties", () => {
			const taskId = "test-task-456"
			const properties = {
				inputTokens: 200,
				outputTokens: 100,
				cacheWriteTokens: 20,
				cacheReadTokens: 10,
				cost: 0.005,
				completionTime: 1500,
				inferenceProvider: "openrouter",
				// Phase 1a additions
				apiProvider: "anthropic",
				modelId: "claude-3-5-sonnet-20241022",
				success: true,
			}

			service.captureLlmCompletion(taskId, properties)

			expect(mockClient.capture).toHaveBeenCalledWith({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: {
					taskId,
					...properties,
				},
			})
		})

		it("should capture LLM completion event with error properties for failed requests", () => {
			const taskId = "test-task-789"
			const properties = {
				inputTokens: 150,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				completionTime: 500,
				apiProvider: "openai",
				modelId: "gpt-4",
				success: false,
				errorType: "RateLimitError",
				errorMessage: "Rate limit exceeded",
			}

			service.captureLlmCompletion(taskId, properties)

			expect(mockClient.capture).toHaveBeenCalledWith({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: {
					taskId,
					...properties,
				},
			})
		})

		it("should capture LLM completion event with optional properties omitted", () => {
			const taskId = "test-task-minimal"
			const properties = {
				inputTokens: 50,
				outputTokens: 25,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}

			service.captureLlmCompletion(taskId, properties)

			expect(mockClient.capture).toHaveBeenCalledWith({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: {
					taskId,
					inputTokens: 50,
					outputTokens: 25,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				},
			})
		})

		it("should not capture when service has no clients", () => {
			// Create a service with no clients
			// @ts-expect-error - Accessing private static property for testing
			TelemetryService._instance = null
			const emptyService = TelemetryService.createInstance([])

			emptyService.captureLlmCompletion("task-id", {
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			// No clients to capture, so nothing should happen
			expect(mockClient.capture).not.toHaveBeenCalled()
		})
	})

	describe("captureToolUsage", () => {
		it("should capture tool usage event", () => {
			const taskId = "test-task-tool"
			const tool = "read_file"
			const toolProtocol = "native"

			service.captureToolUsage(taskId, tool, toolProtocol)

			expect(mockClient.capture).toHaveBeenCalledWith({
				event: TelemetryEventName.TOOL_USED,
				properties: {
					taskId,
					tool,
					toolProtocol,
				},
			})
		})
	})

	describe("singleton pattern", () => {
		it("should return the same instance", () => {
			const instance1 = TelemetryService.instance
			const instance2 = TelemetryService.instance

			expect(instance1).toBe(instance2)
		})

		it("should throw if createInstance is called twice", () => {
			expect(() => TelemetryService.createInstance([])).toThrow("TelemetryService instance already created")
		})

		it("should throw if instance is accessed before creation", () => {
			// @ts-expect-error - Accessing private static property for testing
			TelemetryService._instance = null

			expect(() => TelemetryService.instance).toThrow("TelemetryService not initialized")
		})
	})

	describe("setProvider", () => {
		it("should set provider on all clients", () => {
			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({}),
			}

			service.setProvider(mockProvider)

			expect(mockClient.setProvider).toHaveBeenCalledWith(mockProvider)
		})
	})

	describe("updateTelemetryState", () => {
		it("should update telemetry state on all clients", () => {
			service.updateTelemetryState(true)

			expect(mockClient.updateTelemetryState).toHaveBeenCalledWith(true)
		})
	})

	describe("isTelemetryEnabled", () => {
		it("should return true if any client has telemetry enabled", () => {
			mockClient.isTelemetryEnabled = vi.fn().mockReturnValue(true)

			expect(service.isTelemetryEnabled()).toBe(true)
		})

		it("should return false if no clients have telemetry enabled", () => {
			mockClient.isTelemetryEnabled = vi.fn().mockReturnValue(false)

			expect(service.isTelemetryEnabled()).toBe(false)
		})
	})
})

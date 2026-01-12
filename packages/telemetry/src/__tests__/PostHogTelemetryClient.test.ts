/* eslint-disable @typescript-eslint/no-explicit-any */

// pnpm --filter @roo-code/telemetry test src/__tests__/PostHogTelemetryClient.test.ts

import * as vscode from "vscode"
import { PostHog } from "posthog-node"

import { type TelemetryPropertiesProvider, TelemetryEventName, ApiProviderError } from "@roo-code/types"

import { PostHogTelemetryClient } from "../PostHogTelemetryClient"

vi.mock("posthog-node")

vi.mock("vscode", () => ({
	env: {
		machineId: "test-machine-id",
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

describe("PostHogTelemetryClient", () => {
	const getPrivateProperty = <T>(instance: any, propertyName: string): T => {
		return instance[propertyName]
	}

	let mockPostHogClient: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockPostHogClient = {
			capture: vi.fn(),
			captureException: vi.fn(),
			optIn: vi.fn(),
			optOut: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		}
		;(PostHog as any).mockImplementation(() => mockPostHogClient)

		// @ts-expect-error - Accessing private static property for testing
		PostHogTelemetryClient._instance = undefined
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: vi.fn().mockReturnValue("all"),
		})
	})

	describe("isEventCapturable", () => {
		it("should return true for events not in exclude list", () => {
			const client = new PostHogTelemetryClient()

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CREATED)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.MODE_SWITCH)).toBe(true)
		})

		it("should return false for events in exclude list", () => {
			const client = new PostHogTelemetryClient()

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE /*kilocode_change*/)).toBe(false)
		})
	})

	describe("isPropertyCapturable", () => {
		it("should filter out git repository properties for all users", () => {
			const client = new PostHogTelemetryClient()

			const isPropertyCapturable = getPrivateProperty<
				(propertyName: string, allProperties: Record<string, unknown>) => boolean
			>(client, "isPropertyCapturable").bind(client)

			const noOrgProperties = { appVersion: "1.0.0" }

			// Git properties should be filtered out
			expect(isPropertyCapturable("repositoryUrl", noOrgProperties)).toBe(false)
			expect(isPropertyCapturable("repositoryName", noOrgProperties)).toBe(false)
			expect(isPropertyCapturable("defaultBranch", noOrgProperties)).toBe(false)

			// Other properties should be included
			expect(isPropertyCapturable("appVersion", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("vscodeVersion", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("platform", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("mode", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("customProperty", noOrgProperties)).toBe(true)
		})

		it("should filter out error properties for organization users", () => {
			const client = new PostHogTelemetryClient()

			const isPropertyCapturable = getPrivateProperty<
				(propertyName: string, allProperties: Record<string, unknown>) => boolean
			>(client, "isPropertyCapturable").bind(client)

			const orgProperties = { appVersion: "1.0.0", kilocodeOrganizationId: "org-123" }

			// Error properties should be filtered out for org users
			expect(isPropertyCapturable("errorMessage", orgProperties)).toBe(false)
			expect(isPropertyCapturable("cliPath", orgProperties)).toBe(false)
			expect(isPropertyCapturable("stderrPreview", orgProperties)).toBe(false)

			// Git properties should still be filtered
			expect(isPropertyCapturable("repositoryUrl", orgProperties)).toBe(false)

			// Other properties should be included
			expect(isPropertyCapturable("appVersion", orgProperties)).toBe(true)
			expect(isPropertyCapturable("platform", orgProperties)).toBe(true)
		})

		it("should allow error properties for non-organization users", () => {
			const client = new PostHogTelemetryClient()

			const isPropertyCapturable = getPrivateProperty<
				(propertyName: string, allProperties: Record<string, unknown>) => boolean
			>(client, "isPropertyCapturable").bind(client)

			const noOrgProperties = { appVersion: "1.0.0" }

			// Error properties should be included for non-org users
			expect(isPropertyCapturable("errorMessage", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("cliPath", noOrgProperties)).toBe(true)
			expect(isPropertyCapturable("stderrPreview", noOrgProperties)).toBe(true)
		})
	})

	describe("getEventProperties", () => {
		it("should merge provider properties with event properties", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
					mode: "override", // This should override the provider's mode.
				},
			})

			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "override", // Event property takes precedence.
				customProp: "value",
			})

			expect(mockProvider.getTelemetryProperties).toHaveBeenCalledTimes(1)
		})

		it("should filter out git repository properties", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					// Git properties that should be filtered out
					repositoryUrl: "https://github.com/example/repo",
					repositoryName: "example/repo",
					defaultBranch: "main",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
				},
			})

			// Git properties should be filtered out
			expect(result).not.toHaveProperty("repositoryUrl")
			expect(result).not.toHaveProperty("repositoryName")
			expect(result).not.toHaveProperty("defaultBranch")

			// Other properties should be included
			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
				customProp: "value",
			})
		})

		it("should include organization ID from provider properties", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					kilocodeOrganizationId: "org-123",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
				},
			})

			// Organization ID should be included
			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
				kilocodeOrganizationId: "org-123",
				customProp: "value",
			})
		})

		it("should not override organization ID from event properties", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					kilocodeOrganizationId: "org-from-provider",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					kilocodeOrganizationId: "org-from-event",
				},
			})

			// Event property should take precedence
			expect(result.kilocodeOrganizationId).toBe("org-from-event")
		})

		it("should handle missing organization ID gracefully", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
				},
			})

			// Should not have organization ID
			expect(result).not.toHaveProperty("kilocodeOrganizationId")
			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				customProp: "value",
			})
		})

		it("should handle errors from provider gracefully", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({
				customProp: "value",
				exception: expect.stringContaining("Error: Provider error"),
			})
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error getting telemetry properties: Provider error"),
			)

			consoleErrorSpy.mockRestore()
		})

		it("should return event properties when no provider is set", async () => {
			const client = new PostHogTelemetryClient()

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
		})
	})

	describe("capture", () => {
		it("should not capture events when telemetry is disabled", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(false)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).not.toHaveBeenCalled()
		})

		it("should not capture events that are not capturable", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE, // This is in the exclude list. // kilocode_change
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).not.toHaveBeenCalled()
		})

		it("should capture events when telemetry is enabled and event is capturable", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
				}),
			})
		})

		it("should filter out git repository properties when capturing events", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					// Git properties that should be filtered out
					repositoryUrl: "https://github.com/example/repo",
					repositoryName: "example/repo",
					defaultBranch: "main",
				}),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
				}),
			})

			// Verify git properties are not included
			const captureCall = mockPostHogClient.capture.mock.calls[0][0]
			expect(captureCall.properties).not.toHaveProperty("repositoryUrl")
			expect(captureCall.properties).not.toHaveProperty("repositoryName")
			expect(captureCall.properties).not.toHaveProperty("defaultBranch")
		})

		it("should include organization ID in captured events", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					kilocodeOrganizationId: "org-456",
				}),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
					kilocodeOrganizationId: "org-456",
				}),
			})

			// Verify organization ID is included
			const captureCall = mockPostHogClient.capture.mock.calls[0][0]
			expect(captureCall.properties.kilocodeOrganizationId).toBe("org-456")
		})

		it("should capture events without organization ID when not provided", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
				}),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
				}),
			})

			// Verify organization ID is not included
			const captureCall = mockPostHogClient.capture.mock.calls[0][0]
			expect(captureCall.properties).not.toHaveProperty("kilocodeOrganizationId")
		})
	})

	describe("updateTelemetryState", () => {
		it("should enable telemetry when user opts in and global telemetry is enabled", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("all"),
			})

			client.updateTelemetryState(true)

			expect(client.isTelemetryEnabled()).toBe(true)
			expect(mockPostHogClient.optIn).toHaveBeenCalled()
		})

		it("should disable telemetry when user opts out", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("all"),
			})

			client.updateTelemetryState(false)

			expect(client.isTelemetryEnabled()).toBe(false)
			expect(mockPostHogClient.optOut).toHaveBeenCalled()
		})

		it("should disable telemetry when global telemetry is disabled, regardless of user opt-in", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("off"),
			})

			client.updateTelemetryState(true)
			expect(client.isTelemetryEnabled()).toBe(false)
			expect(mockPostHogClient.optOut).toHaveBeenCalled()
		})
	})

	// kilocode_change: we have our own version of this
	describe.skip("captureException", () => {
		it("should not capture exceptions when telemetry is disabled", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(false)

			const error = new Error("Test error")
			await client.captureException(error)

			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		it("should capture exceptions with app version from provider", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			const error = new Error("Test error")
			await client.captureException(error, { customProp: "value" })

			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(
				error,
				"test-machine-id",
				expect.objectContaining({
					customProp: "value",
					$app_version: "1.0.0",
				}),
			)
		})

		it("should capture exceptions with undefined app version when no provider is set", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new Error("Test error")
			await client.captureException(error)

			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})
	})

	describe("shutdown", () => {
		it("should call shutdown on the PostHog client", async () => {
			const client = new PostHogTelemetryClient()
			await client.shutdown()
			expect(mockPostHogClient.shutdown).toHaveBeenCalled()
		})
	})

	// kilocode_change: we have a different method
	describe.skip("captureException error filtering", () => {
		it("should filter out 429 rate limit errors (via status property)", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an error with status property (like OpenAI SDK errors)
			const error = Object.assign(new Error("Rate limit exceeded"), { status: 429 })
			client.captureException(error)

			// Should NOT capture 429 errors
			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		it("should filter out 402 billing errors (via status property)", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an error with status 402 (Payment Required)
			const error = Object.assign(new Error("Payment required"), { status: 402 })
			client.captureException(error)

			// Should NOT capture 402 errors
			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		it("should filter out errors with '429' in message", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new Error("429 Rate limit exceeded: free-models-per-day")
			client.captureException(error)

			// Should NOT capture errors with 429 in message
			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		it("should filter out errors containing 'rate limit' (case insensitive)", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new Error("Request failed due to Rate Limit")
			client.captureException(error)

			// Should NOT capture rate limit errors
			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		// kilocode_change: we have a different captureException method
		it.skip("should capture non-rate-limit errors", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new Error("Internal server error")
			client.captureException(error)

			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})

		it("should capture errors with non-429 status codes", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = Object.assign(new Error("Internal server error"), { status: 500 })
			client.captureException(error)

			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})

		it("should use nested error message from OpenAI SDK error structure for filtering", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an error with nested metadata (like OpenRouter upstream errors)
			const error = Object.assign(new Error("Request failed"), {
				status: 429,
				error: {
					message: "Error details",
					metadata: { raw: "Rate limit exceeded: free-models-per-day" },
				},
			})
			client.captureException(error)

			// Should NOT capture - the nested metadata.raw contains rate limit message
			expect(mockPostHogClient.captureException).not.toHaveBeenCalled()
		})

		it("should capture errors with nested metadata and override error.message with extracted message", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an OpenAI SDK-like error with nested metadata (non-rate-limit error)
			const error = Object.assign(new Error("Generic request failed"), {
				status: 500,
				error: {
					message: "Nested error message",
					metadata: { raw: "Upstream provider error: model overloaded" },
				},
			})

			client.captureException(error)

			// The implementation overrides error.message with the extracted message from getErrorMessage
			expect(error.message).toBe("Upstream provider error: model overloaded")
			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})

		it("should capture errors with nested error.message and override error.message with extracted message", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an OpenAI SDK-like error with nested message but no metadata.raw
			const error = Object.assign(new Error("Generic request failed"), {
				status: 500,
				error: {
					message: "Upstream provider: connection timeout",
				},
			})

			client.captureException(error)

			// The implementation overrides error.message with the extracted message from getErrorMessage
			expect(error.message).toBe("Upstream provider: connection timeout")
			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})

		it("should use primary message when no nested error structure exists", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			// Create an OpenAI SDK-like error without nested error object
			const error = Object.assign(new Error("Primary error message"), {
				status: 500,
			})

			client.captureException(error)

			// Verify error message remains the primary message
			expect(error.message).toBe("Primary error message")
			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				$app_version: undefined,
			})
		})

		it("should capture ApiProviderError and auto-extract properties", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 500)
			client.captureException(error)

			// The implementation auto-extracts properties from ApiProviderError
			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				provider: "OpenRouter",
				modelId: "gpt-4",
				operation: "createMessage",
				errorCode: 500,
				$app_version: undefined,
			})
		})

		it("should capture ApiProviderError with additionalProperties merged with auto-extracted properties", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			client.captureException(error, { customProperty: "value" })

			// additionalProperties take precedence over auto-extracted properties
			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				provider: "OpenRouter",
				modelId: "gpt-4",
				operation: "createMessage",
				customProperty: "value",
				$app_version: undefined,
			})
		})

		it("should capture regular errors with additionalProperties", () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const error = new Error("Regular error")
			client.captureException(error, { customProperty: "value" })

			expect(mockPostHogClient.captureException).toHaveBeenCalledWith(error, "test-machine-id", {
				customProperty: "value",
				$app_version: undefined,
			})
		})
	})
})

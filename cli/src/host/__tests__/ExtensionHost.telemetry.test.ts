import { describe, it, expect, beforeEach, vi } from "vitest"
import { ExtensionHost } from "../ExtensionHost.js"
import type { ExtensionState } from "../../types/messages.js"

describe("ExtensionHost Telemetry Configuration", () => {
	describe("Initial State Configuration", () => {
		it("should set telemetrySetting to 'unset' in initial state", () => {
			// Create a mock ExtensionHost to test the initializeState method
			const extensionHost = new ExtensionHost({
				workspacePath: "/test/workspace",
				extensionBundlePath: "/test/extension.js",
				extensionRootPath: "/test",
			})

			// Access the private initializeState method through reflection
			// This tests that the initial state is correctly set to "unset"
			const initializeState = (extensionHost as unknown as { initializeState: () => void }).initializeState.bind(
				extensionHost,
			)
			initializeState()

			const api = extensionHost.getAPI()
			const state = api.getState()

			expect(state).toBeDefined()
			expect(state?.telemetrySetting).toBe("unset")
		})

		it("should not initialize with telemetrySetting as 'enabled'", () => {
			const extensionHost = new ExtensionHost({
				workspacePath: "/test/workspace",
				extensionBundlePath: "/test/extension.js",
				extensionRootPath: "/test",
			})

			const initializeState = (extensionHost as unknown as { initializeState: () => void }).initializeState.bind(
				extensionHost,
			)
			initializeState()

			const api = extensionHost.getAPI()
			const state = api.getState()

			expect(state?.telemetrySetting).not.toBe("enabled")
		})
	})

	describe("Configuration Injection", () => {
		let extensionHost: ExtensionHost
		let sendWebviewMessageSpy: ReturnType<typeof vi.fn>

		beforeEach(() => {
			extensionHost = new ExtensionHost({
				workspacePath: "/test/workspace",
				extensionBundlePath: "/test/extension.js",
				extensionRootPath: "/test",
			})

			// Initialize state
			const initializeState = (extensionHost as unknown as { initializeState: () => void }).initializeState.bind(
				extensionHost,
			)
			initializeState()

			// Spy on sendWebviewMessage
			sendWebviewMessageSpy = vi.spyOn(extensionHost, "sendWebviewMessage") as ReturnType<typeof vi.fn>
		})

		it("should update state with telemetrySetting from config", async () => {
			const configState: Partial<ExtensionState> = {
				telemetrySetting: "enabled",
			}

			await extensionHost.injectConfiguration(configState)

			const api = extensionHost.getAPI()
			const state = api.getState()

			expect(state?.telemetrySetting).toBe("enabled")
		})

		it("should update state to disabled when config has telemetry: false", async () => {
			const configState: Partial<ExtensionState> = {
				telemetrySetting: "disabled",
			}

			await extensionHost.injectConfiguration(configState)

			const api = extensionHost.getAPI()
			const state = api.getState()

			expect(state?.telemetrySetting).toBe("disabled")
		})

		it("should call sendWebviewMessage with telemetrySetting message", async () => {
			const configState: Partial<ExtensionState> = {
				telemetrySetting: "disabled",
			}

			await extensionHost.injectConfiguration(configState)

			expect(sendWebviewMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "telemetrySetting",
					text: "disabled",
				}),
			)
		})

		it("should use 'telemetrySetting' (singular) as message type, not 'telemetrySettings'", async () => {
			const configState: Partial<ExtensionState> = {
				telemetrySetting: "enabled",
			}

			await extensionHost.injectConfiguration(configState)

			// Verify the message type is singular
			expect(sendWebviewMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "telemetrySetting", // Not "telemetrySettings"
				}),
			)

			// Verify it was NOT called with the plural form
			expect(sendWebviewMessageSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					type: "telemetrySettings",
				}),
			)
		})
	})

	describe("State Synchronization", () => {
		let extensionHost: ExtensionHost

		beforeEach(() => {
			extensionHost = new ExtensionHost({
				workspacePath: "/test/workspace",
				extensionBundlePath: "/test/extension.js",
				extensionRootPath: "/test",
			})

			// Initialize state
			const initializeState = (extensionHost as unknown as { initializeState: () => void }).initializeState.bind(
				extensionHost,
			)
			initializeState()
		})

		it("should maintain telemetry setting across state updates", async () => {
			// Inject initial configuration
			await extensionHost.injectConfiguration({
				telemetrySetting: "disabled",
			})

			// Update state with other properties
			const api = extensionHost.getAPI()
			api.updateState({
				mode: "architect",
			})

			// Verify telemetry setting is still disabled
			const state = api.getState()
			expect(state?.telemetrySetting).toBe("disabled")
			expect(state?.mode).toBe("architect")
		})

		it("should allow changing telemetry setting after initial configuration", async () => {
			// Inject initial configuration with telemetry enabled
			await extensionHost.injectConfiguration({
				telemetrySetting: "enabled",
			})

			// Verify initial state
			let state = extensionHost.getAPI().getState()
			expect(state?.telemetrySetting).toBe("enabled")

			// Change telemetry setting to disabled
			await extensionHost.injectConfiguration({
				telemetrySetting: "disabled",
			})

			// Verify updated state
			state = extensionHost.getAPI().getState()
			expect(state?.telemetrySetting).toBe("disabled")
		})

		it("should merge telemetry setting with other config properties", async () => {
			// Inject configuration with multiple properties
			await extensionHost.injectConfiguration({
				telemetrySetting: "disabled",
				mode: "debug",
				currentApiConfigName: "test-provider",
			})

			const state = extensionHost.getAPI().getState()
			expect(state?.telemetrySetting).toBe("disabled")
			expect(state?.mode).toBe("debug")
			expect(state?.currentApiConfigName).toBe("test-provider")
		})
	})

	describe("syncConfigurationMessages", () => {
		let extensionHost: ExtensionHost
		let sendWebviewMessageSpy: ReturnType<typeof vi.fn>

		beforeEach(() => {
			extensionHost = new ExtensionHost({
				workspacePath: "/test/workspace",
				extensionBundlePath: "/test/extension.js",
				extensionRootPath: "/test",
			})

			// Initialize state
			const initializeState = (extensionHost as unknown as { initializeState: () => void }).initializeState.bind(
				extensionHost,
			)
			initializeState()

			// Spy on sendWebviewMessage
			sendWebviewMessageSpy = vi.spyOn(extensionHost, "sendWebviewMessage") as ReturnType<typeof vi.fn>
		})

		it("should send telemetrySetting message when telemetry is in config", async () => {
			await extensionHost.syncConfigurationMessages({
				telemetrySetting: "enabled",
			})

			expect(sendWebviewMessageSpy).toHaveBeenCalledWith({
				type: "telemetrySetting",
				text: "enabled",
			})
		})

		it("should not send telemetrySetting message when telemetry is not in config", async () => {
			await extensionHost.syncConfigurationMessages({
				mode: "code",
			})

			expect(sendWebviewMessageSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					type: "telemetrySetting",
				}),
			)
		})

		it("should send multiple configuration messages when multiple configs are present", async () => {
			await extensionHost.syncConfigurationMessages({
				telemetrySetting: "disabled",
				mode: "architect",
			})

			expect(sendWebviewMessageSpy).toHaveBeenCalledWith({
				type: "telemetrySetting",
				text: "disabled",
			})

			expect(sendWebviewMessageSpy).toHaveBeenCalledWith({
				type: "mode",
				text: "architect",
			})
		})
	})
})

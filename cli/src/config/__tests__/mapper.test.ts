import { describe, it, expect } from "vitest"
import { mapConfigToExtensionState } from "../mapper.js"
import type { CLIConfig } from "../types.js"

describe("mapConfigToExtensionState", () => {
	const baseConfig: CLIConfig = {
		version: "1.0.0",
		mode: "code",
		telemetry: true,
		provider: "test-provider",
		providers: [
			{
				id: "test-provider",
				provider: "anthropic",
				apiKey: "test-key",
				apiModelId: "claude-3-5-sonnet-20241022",
			},
		],
	}

	describe("auto-approval settings mapping", () => {
		it("should set all auto-approval settings to false when autoApproval.enabled is false", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: false,
					read: { enabled: true, outside: true },
					write: { enabled: true, outside: true, protected: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.autoApprovalEnabled).toBe(false)
			expect(state.alwaysAllowReadOnly).toBe(false)
			expect(state.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
			expect(state.alwaysAllowWrite).toBe(false)
			expect(state.alwaysAllowWriteOutsideWorkspace).toBe(false)
			expect(state.alwaysAllowWriteProtected).toBe(false)
		})

		it("should set read settings correctly when autoApproval is enabled", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					read: { enabled: true, outside: false },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.autoApprovalEnabled).toBe(true)
			expect(state.alwaysAllowReadOnly).toBe(true)
			expect(state.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
		})

		it("should set alwaysAllowReadOnlyOutsideWorkspace to true only when all conditions are met", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					read: { enabled: true, outside: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowReadOnlyOutsideWorkspace).toBe(true)
		})

		it("should set alwaysAllowReadOnlyOutsideWorkspace to false when read.enabled is false", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					read: { enabled: false, outside: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowReadOnly).toBe(false)
			expect(state.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
		})

		it("should set write settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					write: { enabled: true, outside: true, protected: false },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowWrite).toBe(true)
			expect(state.alwaysAllowWriteOutsideWorkspace).toBe(true)
			expect(state.alwaysAllowWriteProtected).toBe(false)
		})

		it("should set browser settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					browser: { enabled: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowBrowser).toBe(true)
		})

		it("should set execute settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					execute: {
						enabled: true,
						allowed: ["npm", "git"],
						denied: ["rm -rf"],
					},
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowExecute).toBe(true)
			expect(state.allowedCommands).toEqual(["npm", "git"])
			expect(state.deniedCommands).toEqual(["rm -rf"])
		})

		it("should set MCP settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					mcp: { enabled: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowMcp).toBe(true)
		})

		it("should set mode switch settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					mode: { enabled: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowModeSwitch).toBe(true)
		})

		it("should set subtasks settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					subtasks: { enabled: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowSubtasks).toBe(true)
		})

		it("should set retry settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					retry: { enabled: true, delay: 15 },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysApproveResubmit).toBe(true)
			expect(state.requestDelaySeconds).toBe(15)
		})

		it("should set question settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					question: { enabled: true, timeout: 30 },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowFollowupQuestions).toBe(true)
			expect(state.followupAutoApproveTimeoutMs).toBe(30000) // 30 seconds in ms
		})

		it("should set todo settings correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				autoApproval: {
					enabled: true,
					todo: { enabled: true },
				},
			}

			const state = mapConfigToExtensionState(config)

			expect(state.alwaysAllowUpdateTodoList).toBe(true)
		})

		it("should use default values when autoApproval is not provided", () => {
			const config: CLIConfig = {
				...baseConfig,
			}

			const state = mapConfigToExtensionState(config)

			expect(state.autoApprovalEnabled).toBe(false)
			expect(state.alwaysAllowReadOnly).toBe(false)
			expect(state.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
			expect(state.alwaysAllowWrite).toBe(false)
			expect(state.alwaysAllowWriteOutsideWorkspace).toBe(false)
			expect(state.alwaysAllowWriteProtected).toBe(false)
			expect(state.alwaysAllowBrowser).toBe(false)
			expect(state.alwaysAllowMcp).toBe(false)
			expect(state.alwaysAllowModeSwitch).toBe(false)
			expect(state.alwaysAllowSubtasks).toBe(false)
			expect(state.alwaysAllowExecute).toBe(false)
			expect(state.allowedCommands).toEqual([])
			expect(state.deniedCommands).toEqual([])
			expect(state.alwaysAllowFollowupQuestions).toBe(false)
			expect(state.alwaysAllowUpdateTodoList).toBe(false)
		})
	})

	describe("provider mapping", () => {
		it("should map provider configuration correctly", () => {
			const state = mapConfigToExtensionState(baseConfig)

			expect(state.apiConfiguration).toBeDefined()
			expect(state.apiConfiguration?.apiProvider).toBe("anthropic")
			expect(state.currentApiConfigName).toBe("test-provider")
		})

		it("should create listApiConfigMeta from providers", () => {
			const state = mapConfigToExtensionState(baseConfig)

			expect(state.listApiConfigMeta).toHaveLength(1)
			expect(state.listApiConfigMeta?.[0]).toEqual({
				id: "test-provider",
				name: "test-provider",
				apiProvider: "anthropic",
				modelId: "claude-3-5-sonnet-20241022",
			})
		})
	})

	describe("telemetry mapping", () => {
		it("should map telemetry enabled correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				telemetry: true,
			}

			const state = mapConfigToExtensionState(config)

			expect(state.telemetrySetting).toBe("enabled")
		})

		it("should map telemetry disabled correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				telemetry: false,
			}

			const state = mapConfigToExtensionState(config)

			expect(state.telemetrySetting).toBe("disabled")
		})
	})

	describe("mode mapping", () => {
		it("should map mode correctly", () => {
			const config: CLIConfig = {
				...baseConfig,
				mode: "architect",
			}

			const state = mapConfigToExtensionState(config)

			expect(state.mode).toBe("architect")
		})
	})
})

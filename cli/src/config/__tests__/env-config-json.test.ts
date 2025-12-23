import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { buildConfigFromEnv, applyEnvOverrides } from "../env-config.js"
import { ENV_VARS } from "../env-utils.js"
import type { CLIConfig, AutoApprovalConfig } from "../types.js"

describe("env-config JSON auto-approval", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Reset environment for each test
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		process.env = originalEnv
	})

	describe("KILO_AUTO_APPROVAL_JSON parsing", () => {
		const baseConfig: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "kilocode",
			providers: [{ id: "kilocode", provider: "kilocode" }],
			autoApproval: {
				enabled: false,
				read: { enabled: false },
				write: { enabled: false },
			},
		}

		it("parses valid JSON from KILO_AUTO_APPROVAL_JSON", () => {
			const jsonConfig: AutoApprovalConfig = {
				enabled: true,
				read: { enabled: true, outside: true },
				write: { enabled: true, outside: false, protected: true },
				browser: { enabled: true },
				mcp: { enabled: false },
				execute: { enabled: true, allowed: ["npm test"], denied: ["rm"] },
			}

			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = JSON.stringify(jsonConfig)

			const result = applyEnvOverrides(baseConfig)

			expect(result.autoApproval).toEqual(jsonConfig)
		})

		it("ignores individual env vars when JSON is set", () => {
			const jsonConfig: AutoApprovalConfig = {
				enabled: true,
				read: { enabled: true },
			}

			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = JSON.stringify(jsonConfig)
			// These should be ignored
			process.env[ENV_VARS.AUTO_APPROVAL_ENABLED] = "false"
			process.env[ENV_VARS.AUTO_APPROVAL_READ_ENABLED] = "false"

			const result = applyEnvOverrides(baseConfig)

			// Should use JSON config, not individual env vars
			expect(result.autoApproval?.enabled).toBe(true)
			expect(result.autoApproval?.read?.enabled).toBe(true)
		})

		it("falls back to individual env vars when JSON is not set", () => {
			process.env[ENV_VARS.AUTO_APPROVAL_ENABLED] = "true"
			process.env[ENV_VARS.AUTO_APPROVAL_READ_ENABLED] = "true"

			const result = applyEnvOverrides(baseConfig)

			expect(result.autoApproval?.enabled).toBe(true)
			expect(result.autoApproval?.read?.enabled).toBe(true)
		})

		it("falls back to individual env vars when JSON is invalid", () => {
			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = "not valid json"
			process.env[ENV_VARS.AUTO_APPROVAL_ENABLED] = "true"

			const result = applyEnvOverrides(baseConfig)

			// Should fall back to individual env vars
			expect(result.autoApproval?.enabled).toBe(true)
		})

		it("handles empty JSON string gracefully", () => {
			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = ""
			process.env[ENV_VARS.AUTO_APPROVAL_ENABLED] = "true"

			const result = applyEnvOverrides(baseConfig)

			// Empty string should fall back to individual env vars
			expect(result.autoApproval?.enabled).toBe(true)
		})

		it("preserves all auto-approval fields from JSON", () => {
			const fullConfig: AutoApprovalConfig = {
				enabled: true,
				read: { enabled: true, outside: true },
				write: { enabled: true, outside: true, protected: true },
				browser: { enabled: true },
				retry: { enabled: true, delay: 15 },
				mcp: { enabled: true },
				mode: { enabled: true },
				subtasks: { enabled: true },
				execute: { enabled: true, allowed: ["npm", "pnpm"], denied: ["rm -rf"] },
				question: { enabled: false, timeout: 30000 },
				todo: { enabled: true },
			}

			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = JSON.stringify(fullConfig)

			const result = applyEnvOverrides(baseConfig)

			expect(result.autoApproval).toEqual(fullConfig)
		})
	})

	describe("buildConfigFromEnv with JSON", () => {
		it("uses JSON config when building from env", () => {
			const jsonConfig: AutoApprovalConfig = {
				enabled: true,
				read: { enabled: true },
				write: { enabled: false },
			}

			// Set up minimal required env vars for buildConfigFromEnv to work
			process.env[ENV_VARS.PROVIDER_TYPE] = "kilocode"
			process.env["KILOCODE_TOKEN"] = "test-token"
			process.env[ENV_VARS.AUTO_APPROVAL_JSON] = JSON.stringify(jsonConfig)

			const result = buildConfigFromEnv()

			expect(result).not.toBeNull()
			expect(result?.autoApproval).toEqual(jsonConfig)
		})
	})
})

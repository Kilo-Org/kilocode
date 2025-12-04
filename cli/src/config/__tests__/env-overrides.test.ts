import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { applyEnvOverrides, PROVIDER_ENV_VAR, KILOCODE_PREFIX, KILO_PREFIX } from "../env-config.js"
import type { CLIConfig } from "../types.js"

describe("env-overrides", () => {
	const originalEnv = process.env
	let testConfig: CLIConfig

	beforeEach(() => {
		// Reset environment variables before each test
		process.env = { ...originalEnv }

		// Clear any KILOCODE_* or KILO_* environment variables to ensure clean test state
		for (const key of Object.keys(process.env)) {
			if (key.startsWith(KILOCODE_PREFIX) || key.startsWith(KILO_PREFIX)) {
				delete process.env[key]
			}
		}

		// Create a test config
		testConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "anthropic/claude-sonnet-4.5",
					kilocodeOrganizationId: "original-org-id",
				},
				{
					id: "anthropic-provider",
					provider: "anthropic",
					apiKey: "test-key",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
			autoApproval: {
				enabled: true,
			},
			theme: "dark",
			customThemes: {},
		}
	})

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv
	})

	describe("KILO_PROVIDER override", () => {
		it("should override provider when KILO_PROVIDER is set and provider exists", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("anthropic-provider")
		})

		it("should not override provider when KILO_PROVIDER provider does not exist", () => {
			process.env[PROVIDER_ENV_VAR] = "nonexistent-provider"

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("default")
		})

		it("should not override provider when KILO_PROVIDER is empty", () => {
			process.env[PROVIDER_ENV_VAR] = ""

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("default")
		})
	})

	describe("KILOCODE_* overrides for kilocode provider", () => {
		it("should transform KILOCODE_MODEL to kilocodeModel", () => {
			process.env[`${KILOCODE_PREFIX}MODEL`] = "anthropic/claude-opus-4.0"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.kilocodeModel).toBe("anthropic/claude-opus-4.0")
		})

		it("should transform KILOCODE_ORGANIZATION_ID to kilocodeOrganizationId", () => {
			process.env[`${KILOCODE_PREFIX}ORGANIZATION_ID`] = "new-org-id"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.kilocodeOrganizationId).toBe("new-org-id")
		})

		it("should handle multiple KILOCODE_* overrides", () => {
			process.env[`${KILOCODE_PREFIX}MODEL`] = "anthropic/claude-opus-4.0"
			process.env[`${KILOCODE_PREFIX}ORGANIZATION_ID`] = "new-org-id"
			process.env[`${KILOCODE_PREFIX}TOKEN`] = "new-token"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.kilocodeModel).toBe("anthropic/claude-opus-4.0")
			expect(provider?.kilocodeOrganizationId).toBe("new-org-id")
			expect(provider?.kilocodeToken).toBe("new-token")
		})
	})

	describe("KILO_* overrides for non-kilocode providers", () => {
		it("should transform KILO_API_KEY to apiKey for non-kilocode provider", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILO_PREFIX}API_KEY`] = "new-key"

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("anthropic-provider")
			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.apiKey).toBe("new-key")
		})

		it("should transform KILO_API_MODEL_ID to apiModelId", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILO_PREFIX}API_MODEL_ID`] = "claude-3-opus-20240229"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.apiModelId).toBe("claude-3-opus-20240229")
		})

		it("should transform KILO_BASE_URL to baseUrl", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILO_PREFIX}BASE_URL`] = "https://api.example.com"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.baseUrl).toBe("https://api.example.com")
		})

		it("should not apply KILO_* overrides to kilocode provider", () => {
			process.env[PROVIDER_ENV_VAR] = "kilocode"
			process.env[`${KILO_PREFIX}API_KEY`] = "should-not-apply"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.apiKey).toBeUndefined()
		})

		it("should not apply KILOCODE_* overrides to non-kilocode provider", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILOCODE_PREFIX}MODEL`] = "should-not-apply"

			const result = applyEnvOverrides(testConfig)

			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.kilocodeModel).toBeUndefined()
		})
	})

	describe("Combined overrides", () => {
		it("should apply both provider and field overrides together for non-kilocode provider", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILO_PREFIX}API_MODEL_ID`] = "claude-3-opus-20240229"
			process.env[`${KILO_PREFIX}API_KEY`] = "new-key"

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("anthropic-provider")
			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.apiModelId).toBe("claude-3-opus-20240229")
			expect(provider?.apiKey).toBe("new-key")
		})

		it("should apply both provider and field overrides together for kilocode provider", () => {
			process.env[PROVIDER_ENV_VAR] = "default"
			process.env[`${KILOCODE_PREFIX}MODEL`] = "anthropic/claude-opus-4.0"
			process.env[`${KILOCODE_PREFIX}ORGANIZATION_ID`] = "new-org-id"

			const result = applyEnvOverrides(testConfig)

			expect(result.provider).toBe("default")
			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.kilocodeModel).toBe("anthropic/claude-opus-4.0")
			expect(provider?.kilocodeOrganizationId).toBe("new-org-id")
		})
	})

	describe("Edge cases", () => {
		it("should handle empty config providers array", () => {
			testConfig.providers = []

			const result = applyEnvOverrides(testConfig)

			expect(result.providers).toEqual([])
		})

		it("should handle config with no current provider", () => {
			testConfig.provider = "nonexistent"

			const result = applyEnvOverrides(testConfig)

			expect(result).toEqual(testConfig)
		})

		it("should handle empty string override values for KILOCODE_*", () => {
			process.env[`${KILOCODE_PREFIX}MODEL`] = ""

			const result = applyEnvOverrides(testConfig)

			// Empty strings should not trigger overrides
			const provider = result.providers.find((p) => p.id === "default")
			expect(provider?.kilocodeModel).toBe("anthropic/claude-sonnet-4.5")
		})

		it("should handle empty string override values for KILO_*", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"
			process.env[`${KILO_PREFIX}API_KEY`] = ""

			const result = applyEnvOverrides(testConfig)

			// Empty strings should not trigger overrides
			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.apiKey).toBe("test-key")
		})

		it("should ignore KILOCODE_ with no field name", () => {
			process.env[KILOCODE_PREFIX.slice(0, -1)] = "value"

			const result = applyEnvOverrides(testConfig)

			// Should not modify anything
			expect(result).toEqual(testConfig)
		})

		it("should ignore KILO_PROVIDER since it's handled separately", () => {
			process.env[PROVIDER_ENV_VAR] = "anthropic-provider"

			const result = applyEnvOverrides(testConfig)

			// KILO_PROVIDER should change the provider but not add a 'provider' field
			expect(result.provider).toBe("anthropic-provider")

			const provider = result.providers.find((p) => p.id === "anthropic-provider")
			expect(provider?.provider).toBe("anthropic") // Original value
		})
	})
})

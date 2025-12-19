import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setEphemeralMode, isEphemeralMode } from "../env-config.js"

// Mock the logs service
vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("Ephemeral Mode", () => {
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env }
		// Clear ephemeral mode related env vars
		delete process.env.KILO_EPHEMERAL_MODE
		delete process.env.KILO_PROVIDER_TYPE
	})

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv
	})

	describe("setEphemeralMode", () => {
		it("should enable ephemeral mode when called with true", () => {
			setEphemeralMode(true)
			expect(isEphemeralMode()).toBe(true)
		})

		it("should disable ephemeral mode when called with false", () => {
			setEphemeralMode(true)
			expect(isEphemeralMode()).toBe(true)
			setEphemeralMode(false)
			expect(isEphemeralMode()).toBe(false)
		})
	})

	describe("isEphemeralMode", () => {
		it("should return true when CLI flag is set", () => {
			setEphemeralMode(true)
			expect(isEphemeralMode()).toBe(true)
		})

		it("should return false when CLI flag is not set and no env config", () => {
			setEphemeralMode(false)
			expect(isEphemeralMode()).toBe(false)
		})

		it("should return true when env var is set and env config exists", () => {
			setEphemeralMode(false)
			process.env.KILO_EPHEMERAL_MODE = "true"
			process.env.KILO_PROVIDER_TYPE = "anthropic"
			expect(isEphemeralMode()).toBe(true)
		})

		it("should return false when env var is explicitly set to false", () => {
			setEphemeralMode(false)
			process.env.KILO_EPHEMERAL_MODE = "false"
			process.env.KILO_PROVIDER_TYPE = "anthropic"
			expect(isEphemeralMode()).toBe(false)
		})

		it("should prioritize CLI flag over env var", () => {
			// Set CLI flag to true
			setEphemeralMode(true)
			// Set env var to false
			process.env.KILO_EPHEMERAL_MODE = "false"
			process.env.KILO_PROVIDER_TYPE = "anthropic"
			// CLI flag should take precedence
			expect(isEphemeralMode()).toBe(true)
		})

		it("should return false when env var is set but no env config exists", () => {
			setEphemeralMode(false)
			process.env.KILO_EPHEMERAL_MODE = "true"
			// No KILO_PROVIDER_TYPE set, so env config doesn't exist
			expect(isEphemeralMode()).toBe(false)
		})
	})

	describe("integration with config persistence", () => {
		it("should prevent config writes when ephemeral mode is enabled via CLI", async () => {
			setEphemeralMode(true)
			expect(isEphemeralMode()).toBe(true)

			// This test verifies the flag is set correctly
			// The actual prevention of writes is tested in persistence.test.ts
		})

		it("should allow config writes when ephemeral mode is disabled", async () => {
			setEphemeralMode(false)
			expect(isEphemeralMode()).toBe(false)
		})
	})
})

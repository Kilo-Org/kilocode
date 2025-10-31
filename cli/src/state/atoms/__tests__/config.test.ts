import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { loadConfigAtom, configAtom, configValidationAtom } from "../config.js"
import * as persistence from "../../../config/persistence.js"

// Mock the persistence module
vi.mock("../../../config/persistence.js", () => ({
	loadConfig: vi.fn(),
	saveConfig: vi.fn(),
}))

describe("loadConfigAtom", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should load config from disk", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "ask",
			provider: "anthropic",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue({
			config: mockConfig,
			validation: { valid: true },
		})

		const store = createStore()
		await store.set(loadConfigAtom)

		const config = store.get(configAtom)
		expect(config.mode).toBe("ask")

		const validation = store.get(configValidationAtom)
		expect(validation.valid).toBe(true)
	})

	it("should override mode when provided", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "ask",
			provider: "anthropic",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue({
			config: mockConfig,
			validation: { valid: true },
		})

		const store = createStore()
		await store.set(loadConfigAtom, "debug")

		const config = store.get(configAtom)
		expect(config.mode).toBe("debug")

		const validation = store.get(configValidationAtom)
		expect(validation.valid).toBe(true)
	})

	it("should not override mode when not provided", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			provider: "anthropic",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue({
			config: mockConfig,
			validation: { valid: true },
		})

		const store = createStore()
		await store.set(loadConfigAtom, undefined)

		const config = store.get(configAtom)
		expect(config.mode).toBe("code")

		const validation = store.get(configValidationAtom)
		expect(validation.valid).toBe(true)
	})

	it("should store validation errors when config is invalid", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			provider: "test",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue({
			config: mockConfig,
			validation: {
				valid: false,
				errors: ["Provider 'test': apiKey is required and cannot be empty"],
			},
		})

		const store = createStore()
		await store.set(loadConfigAtom)

		const config = store.get(configAtom)
		expect(config).toEqual(mockConfig)

		const validation = store.get(configValidationAtom)
		expect(validation.valid).toBe(false)
		expect(validation.errors).toHaveLength(1)
		expect(validation.errors![0]).toContain("apiKey is required")
	})
})

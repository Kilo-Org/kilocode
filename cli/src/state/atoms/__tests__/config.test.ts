import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { loadConfigAtom, configAtom } from "../config.js"
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

		vi.mocked(persistence.loadConfig).mockResolvedValue(mockConfig)

		const store = createStore()
		await store.set(loadConfigAtom)

		const config = store.get(configAtom)
		expect(config.mode).toBe("ask")
	})

	it("should override mode when provided", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "ask",
			provider: "anthropic",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue(mockConfig)

		const store = createStore()
		await store.set(loadConfigAtom, "debug")

		const config = store.get(configAtom)
		expect(config.mode).toBe("debug")
	})

	it("should not override mode when not provided", async () => {
		const mockConfig = {
			version: "1.0.0" as const,
			mode: "code",
			provider: "anthropic",
			providers: [],
			telemetry: true,
		}

		vi.mocked(persistence.loadConfig).mockResolvedValue(mockConfig)

		const store = createStore()
		await store.set(loadConfigAtom, undefined)

		const config = store.get(configAtom)
		expect(config.mode).toBe("code")
	})
})

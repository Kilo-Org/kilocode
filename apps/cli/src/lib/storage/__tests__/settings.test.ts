import fs from "fs/promises"
import path from "path"

// Use vi.hoisted to make the test directory available to the mock
// This must return the path synchronously since settings path is computed at import time
const { getTestConfigDir } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const os = require("os")
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require("path")
	const testRunId = Date.now().toString()
	const testConfigDir = path.join(os.tmpdir(), `roo-cli-settings-test-${testRunId}`)
	return { getTestConfigDir: () => testConfigDir }
})

vi.mock("../config-dir.js", () => ({
	getConfigDir: getTestConfigDir,
}))

// Import after mocking
import { loadSettings, saveSettings, resetOnboarding, getSettingsPath } from "../settings.js"
import { OnboardingProviderChoice } from "@/types/index.js"

// Re-derive the test config dir for use in tests (must match the hoisted one)
const actualTestConfigDir = getTestConfigDir()

describe("Settings Storage", () => {
	const expectedSettingsFile = path.join(actualTestConfigDir, "cli-settings.json")

	beforeEach(async () => {
		// Clear test directory before each test
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	afterAll(async () => {
		// Clean up test directory
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	describe("getSettingsPath", () => {
		it("should return the correct settings file path", () => {
			expect(getSettingsPath()).toBe(expectedSettingsFile)
		})
	})

	describe("loadSettings", () => {
		it("should return empty object if no settings file exists", async () => {
			const settings = await loadSettings()
			expect(settings).toEqual({})
		})

		it("should load saved settings", async () => {
			const settingsData = {
				onboardingProviderChoice: OnboardingProviderChoice.Roo,
				mode: "architect",
				provider: "anthropic" as const,
				model: "claude-sonnet-4-20250514",
				reasoningEffort: "high" as const,
			}

			await fs.mkdir(actualTestConfigDir, { recursive: true })
			await fs.writeFile(expectedSettingsFile, JSON.stringify(settingsData), "utf-8")

			const loaded = await loadSettings()
			expect(loaded).toEqual(settingsData)
		})

		it("should load settings with only some fields set", async () => {
			const settingsData = {
				mode: "code",
			}

			await fs.mkdir(actualTestConfigDir, { recursive: true })
			await fs.writeFile(expectedSettingsFile, JSON.stringify(settingsData), "utf-8")

			const loaded = await loadSettings()
			expect(loaded).toEqual(settingsData)
		})
	})

	describe("saveSettings", () => {
		it("should save settings to disk", async () => {
			await saveSettings({ mode: "debug" })

			const savedData = await fs.readFile(expectedSettingsFile, "utf-8")
			const settings = JSON.parse(savedData)

			expect(settings.mode).toBe("debug")
		})

		it("should merge settings with existing ones", async () => {
			await saveSettings({ mode: "code" })
			await saveSettings({ provider: "openrouter" as const })

			const savedData = await fs.readFile(expectedSettingsFile, "utf-8")
			const settings = JSON.parse(savedData)

			expect(settings.mode).toBe("code")
			expect(settings.provider).toBe("openrouter")
		})

		it("should save all default settings fields", async () => {
			await saveSettings({
				mode: "architect",
				provider: "anthropic" as const,
				model: "claude-opus-4.5",
				reasoningEffort: "medium" as const,
			})

			const savedData = await fs.readFile(expectedSettingsFile, "utf-8")
			const settings = JSON.parse(savedData)

			expect(settings.mode).toBe("architect")
			expect(settings.provider).toBe("anthropic")
			expect(settings.model).toBe("claude-opus-4.5")
			expect(settings.reasoningEffort).toBe("medium")
		})

		it("should create config directory if it doesn't exist", async () => {
			await saveSettings({ mode: "ask" })

			const dirStats = await fs.stat(actualTestConfigDir)
			expect(dirStats.isDirectory()).toBe(true)
		})

		// Unix file permissions don't apply on Windows - skip this test
		it.skipIf(process.platform === "win32")("should set restrictive file permissions", async () => {
			await saveSettings({ mode: "code" })

			const stats = await fs.stat(expectedSettingsFile)
			// Check that only owner has read/write (mode 0o600)
			const mode = stats.mode & 0o777
			expect(mode).toBe(0o600)
		})
	})

	describe("resetOnboarding", () => {
		it("should reset onboarding provider choice", async () => {
			await saveSettings({ onboardingProviderChoice: OnboardingProviderChoice.Roo })

			await resetOnboarding()

			const settings = await loadSettings()
			expect(settings.onboardingProviderChoice).toBeUndefined()
		})

		it("should preserve other settings when resetting onboarding", async () => {
			await saveSettings({
				onboardingProviderChoice: OnboardingProviderChoice.Byok,
				mode: "architect",
				provider: "gemini" as const,
			})

			await resetOnboarding()

			const settings = await loadSettings()
			expect(settings.onboardingProviderChoice).toBeUndefined()
			expect(settings.mode).toBe("architect")
			expect(settings.provider).toBe("gemini")
		})
	})

	describe("default settings priority", () => {
		it("should support all configurable default settings", async () => {
			// Test that all the settings that can be used as defaults are properly saved and loaded
			const defaultSettings = {
				mode: "debug",
				provider: "openai-native" as const,
				model: "gpt-4o",
				reasoningEffort: "low" as const,
			}

			await saveSettings(defaultSettings)
			const loaded = await loadSettings()

			expect(loaded.mode).toBe("debug")
			expect(loaded.provider).toBe("openai-native")
			expect(loaded.model).toBe("gpt-4o")
			expect(loaded.reasoningEffort).toBe("low")
		})

		it("should support dangerouslySkipPermissions setting", async () => {
			await saveSettings({ dangerouslySkipPermissions: true })
			const loaded = await loadSettings()

			expect(loaded.dangerouslySkipPermissions).toBe(true)
		})

		it("should support all settings together including dangerouslySkipPermissions", async () => {
			const allSettings = {
				mode: "architect",
				provider: "anthropic" as const,
				model: "claude-sonnet-4-20250514",
				reasoningEffort: "high" as const,
				dangerouslySkipPermissions: true,
			}

			await saveSettings(allSettings)
			const loaded = await loadSettings()

			expect(loaded.mode).toBe("architect")
			expect(loaded.provider).toBe("anthropic")
			expect(loaded.model).toBe("claude-sonnet-4-20250514")
			expect(loaded.reasoningEffort).toBe("high")
			expect(loaded.dangerouslySkipPermissions).toBe(true)
		})

		it("should support oneshot setting", async () => {
			await saveSettings({ oneshot: true })
			const loaded = await loadSettings()

			expect(loaded.oneshot).toBe(true)
		})

		it("should support all settings together including oneshot", async () => {
			const allSettings = {
				mode: "architect",
				provider: "anthropic" as const,
				model: "claude-sonnet-4-20250514",
				reasoningEffort: "high" as const,
				dangerouslySkipPermissions: true,
				oneshot: true,
			}

			await saveSettings(allSettings)
			const loaded = await loadSettings()

			expect(loaded.mode).toBe("architect")
			expect(loaded.provider).toBe("anthropic")
			expect(loaded.model).toBe("claude-sonnet-4-20250514")
			expect(loaded.reasoningEffort).toBe("high")
			expect(loaded.dangerouslySkipPermissions).toBe(true)
			expect(loaded.oneshot).toBe(true)
		})
	})
})

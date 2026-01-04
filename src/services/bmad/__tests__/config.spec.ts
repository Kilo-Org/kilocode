import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BmadConfigManager } from "../config"
import type { BmadConfig } from "../types"
import * as vscode from "vscode"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key: string) => {
				const defaults: Record<string, any> = {
					enabled: true,
					installationPath: "_bmad",
					activeModules: ["bmm", "bmb", "cis", "bmgd"],
					defaultWorkflow: null,
					autoSyncModes: true,
					syncInterval: 300000,
					knowledgeBaseEnabled: true,
					partyModeEnabled: true,
					customModulesPath: null,
					debugMode: false,
				}
				return defaults[key]
			}),
			update: vi.fn(),
			onDidChangeConfiguration: vi.fn(() => ({
				dispose: vi.fn(),
			})),
			createFileSystemWatcher: vi.fn(() => ({
				onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
				onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
				onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
				dispose: vi.fn(),
			})),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
	},
}))

// Mock other dependencies
vi.mock("../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(() => Promise.resolve(false)),
}))

vi.mock("../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/workspace"),
}))

vi.mock("../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("../../i18n", () => ({
	t: vi.fn((key: string, params?: any) => `${key}${params ? JSON.stringify(params) : ""}`),
}))

describe("BmadConfigManager", () => {
	let configManager: BmadConfigManager
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		mockContext = {
			globalStorageUri: {
				fsPath: "/global-storage",
			},
		} as any

		configManager = new BmadConfigManager(mockContext)
	})

	afterEach(() => {
		configManager.dispose()
	})

	describe("initialization", () => {
		it("should initialize with default configuration", async () => {
			await configManager.initialize()
			const config = configManager.getConfig()

			expect(config.enabled).toBe(true)
			expect(config.installationPath).toBe("_bmad")
			expect(config.activeModules).toEqual(["bmm", "bmb", "cis", "bmgd"])
			expect(config.autoSyncModes).toBe(true)
			expect(config.syncInterval).toBe(300000)
			expect(config.knowledgeBaseEnabled).toBe(true)
			expect(config.partyModeEnabled).toBe(true)
			expect(config.debugMode).toBe(false)
		})

		it("should load configuration from VS Code settings", async () => {
			await configManager.initialize()
			const config = configManager.getConfig()

			// Verify that configuration was loaded from mocked VS Code settings
			expect(config.activeModules).toContain("bmm")
			expect(config.activeModules).toContain("bmb")
		})
	})

	describe("configuration management", () => {
		it("should get current configuration", async () => {
			await configManager.initialize()
			const config = configManager.getConfig()

			expect(config).toBeDefined()
			expect(typeof config.enabled).toBe("boolean")
			expect(typeof config.installationPath).toBe("string")
		})

		it("should update single configuration value", async () => {
			await configManager.initialize()

			await configManager.updateConfig("enabled", false)
			const config = configManager.getConfig()

			expect(config.enabled).toBe(false)
		})

		it("should update multiple configuration values", async () => {
			await configManager.initialize()

			const updates: Partial<BmadConfig> = {
				enabled: false,
				syncInterval: 600000,
			}

			await configManager.updateConfigMultiple(updates)
			const config = configManager.getConfig()

			expect(config.enabled).toBe(false)
			expect(config.syncInterval).toBe(600000)
		})
	})

	describe("validation", () => {
		it("should validate valid configuration", async () => {
			await configManager.initialize()
			const result = configManager.validateConfig()

			expect(result.isValid).toBe(true)
			expect(result.errors).toEqual([])
		})

		it("should detect invalid installation path", async () => {
			await configManager.initialize()

			// Manually set invalid config
			await configManager.updateConfig("installationPath", "")

			const result = configManager.validateConfig()

			expect(result.isValid).toBe(false)
			expect(result.errors.length).toBeGreaterThan(0)
			expect(result.errors.some((e) => e.includes("Installation path"))).toBe(true)
		})

		it("should detect invalid sync interval", async () => {
			await configManager.initialize()

			// Manually set invalid config (less than 60 seconds)
			await configManager.updateConfig("syncInterval", 30000)

			const result = configManager.validateConfig()

			expect(result.isValid).toBe(false)
			expect(result.errors.length).toBeGreaterThan(0)
			expect(result.errors.some((e) => e.includes("Sync interval"))).toBe(true)
		})
	})

	describe("helper methods", () => {
		it("should check if BMAD is enabled", async () => {
			await configManager.initialize()

			expect(configManager.isEnabled()).toBe(true)

			await configManager.updateConfig("enabled", false)
			expect(configManager.isEnabled()).toBe(false)
		})

		it("should get installation path", async () => {
			await configManager.initialize()

			const path = configManager.getInstallationPath()
			expect(path).toContain("_bmad")
		})

		it("should get active modules", async () => {
			await configManager.initialize()

			const modules = configManager.getActiveModules()
			expect(modules).toContain("bmm")
			expect(modules).toContain("bmb")
		})

		it("should check if module is active", async () => {
			await configManager.initialize()

			expect(configManager.isModuleActive("bmm")).toBe(true)
			expect(configManager.isModuleActive("invalid-module")).toBe(false)
		})
	})

	describe("reset configuration", () => {
		it("should reset configuration to defaults", async () => {
			await configManager.initialize()

			// Modify configuration
			await configManager.updateConfig("enabled", false)
			await configManager.updateConfig("syncInterval", 600000)

			// Reset
			await configManager.resetConfig()

			const config = configManager.getConfig()
			expect(config.enabled).toBe(true)
			expect(config.syncInterval).toBe(300000)
		})
	})

	describe("disposal", () => {
		it("should dispose resources", async () => {
			await configManager.initialize()

			configManager.dispose()

			// Should not throw when disposing again
			expect(() => configManager.dispose()).not.toThrow()
		})
	})
})

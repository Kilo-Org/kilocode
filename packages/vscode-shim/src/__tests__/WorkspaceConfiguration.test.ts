import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import {
	MockWorkspaceConfiguration,
	setRuntimeConfig,
	setRuntimeConfigValues,
	getRuntimeConfig,
	clearRuntimeConfig,
} from "../api/WorkspaceConfiguration.js"
import { ExtensionContextImpl } from "../context/ExtensionContext.js"

describe("MockWorkspaceConfiguration", () => {
	let tempDir: string
	let extensionPath: string
	let workspacePath: string
	let context: ExtensionContextImpl

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "config-test-"))
		extensionPath = path.join(tempDir, "extension")
		workspacePath = path.join(tempDir, "workspace")
		fs.mkdirSync(extensionPath, { recursive: true })
		fs.mkdirSync(workspacePath, { recursive: true })

		context = new ExtensionContextImpl({
			extensionPath,
			workspacePath,
			storageDir: path.join(tempDir, "storage"),
		})
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	describe("get()", () => {
		it("should return default value when key doesn't exist", () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			expect(config.get("nonexistent", "default")).toBe("default")
		})

		it("should return undefined when key doesn't exist and no default provided", () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			expect(config.get("nonexistent")).toBeUndefined()
		})

		it("should return stored value", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("setting", "value")

			expect(config.get("setting")).toBe("value")
		})

		it("should use section prefix", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("nested.setting", "nested value")

			expect(config.get("nested.setting")).toBe("nested value")
		})

		it("should handle complex values", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)
			const complexValue = { nested: { array: [1, 2, 3] } }

			await config.update("complex", complexValue)

			expect(config.get("complex")).toEqual(complexValue)
		})
	})

	describe("has()", () => {
		it("should return false for non-existent key", () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			expect(config.has("nonexistent")).toBe(false)
		})

		it("should return true for existing key", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("exists", "value")

			expect(config.has("exists")).toBe(true)
		})
	})

	describe("inspect()", () => {
		it("should return undefined for non-existent key", () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			expect(config.inspect("nonexistent")).toBeUndefined()
		})

		it("should return inspection result for existing key", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("setting", "global value", 1) // Global

			const inspection = config.inspect<string>("setting")

			expect(inspection).toBeDefined()
			expect(inspection?.key).toBe("myExtension.setting")
			expect(inspection?.globalValue).toBe("global value")
		})

		it("should return workspace value when set", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("workspaceSetting", "workspace value", 2) // Workspace

			const inspection = config.inspect<string>("workspaceSetting")

			expect(inspection).toBeDefined()
			expect(inspection?.workspaceValue).toBe("workspace value")
		})
	})

	describe("update()", () => {
		it("should update global configuration", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("globalSetting", "global value", 1) // Global

			expect(config.get("globalSetting")).toBe("global value")
		})

		it("should update workspace configuration", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			await config.update("workspaceSetting", "workspace value", 2) // Workspace

			expect(config.get("workspaceSetting")).toBe("workspace value")
		})

		it("should persist configuration across instances", async () => {
			const config1 = new MockWorkspaceConfiguration("myExtension", context)
			await config1.update("persistent", "value")

			// Create new config instance
			const config2 = new MockWorkspaceConfiguration("myExtension", context)

			expect(config2.get("persistent")).toBe("value")
		})

		it("should allow updating with null/undefined to clear value", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)
			await config.update("toDelete", "value")

			expect(config.get("toDelete")).toBe("value")

			await config.update("toDelete", undefined)

			expect(config.get("toDelete")).toBeUndefined()
		})
	})

	describe("reload()", () => {
		it("should not throw when called", () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)

			expect(() => config.reload()).not.toThrow()
		})
	})

	describe("getAllConfig()", () => {
		it("should return all configuration values", async () => {
			const config = new MockWorkspaceConfiguration("myExtension", context)
			await config.update("key1", "value1")
			await config.update("key2", "value2")

			const allConfig = config.getAllConfig()

			expect(allConfig["myExtension.key1"]).toBe("value1")
			expect(allConfig["myExtension.key2"]).toBe("value2")
		})
	})

	describe("Runtime Configuration", () => {
		beforeEach(() => {
			// Clear runtime config before each test
			clearRuntimeConfig()
		})

		afterEach(() => {
			// Clean up after each test
			clearRuntimeConfig()
		})

		it("should return runtime config value over disk-based values", async () => {
			const config = new MockWorkspaceConfiguration("roo-cline", context)

			// Set a value in disk-based storage
			await config.update("commandExecutionTimeout", 10)

			// Verify disk value is returned
			expect(config.get("commandExecutionTimeout")).toBe(10)

			// Set runtime config (should take precedence)
			setRuntimeConfig("roo-cline", "commandExecutionTimeout", 20)

			// Now runtime value should be returned
			expect(config.get("commandExecutionTimeout")).toBe(20)
		})

		it("should set and get runtime config values", () => {
			setRuntimeConfig("roo-cline", "testSetting", "testValue")

			expect(getRuntimeConfig("roo-cline.testSetting")).toBe("testValue")
		})

		it("should set multiple runtime config values at once", () => {
			setRuntimeConfigValues("roo-cline", {
				setting1: "value1",
				setting2: 42,
				setting3: true,
			})

			expect(getRuntimeConfig("roo-cline.setting1")).toBe("value1")
			expect(getRuntimeConfig("roo-cline.setting2")).toBe(42)
			expect(getRuntimeConfig("roo-cline.setting3")).toBe(true)
		})

		it("should ignore undefined values in setRuntimeConfigValues", () => {
			setRuntimeConfigValues("roo-cline", {
				defined: "value",
				notDefined: undefined,
			})

			expect(getRuntimeConfig("roo-cline.defined")).toBe("value")
			expect(getRuntimeConfig("roo-cline.notDefined")).toBeUndefined()
		})

		it("should clear all runtime config values", () => {
			setRuntimeConfig("roo-cline", "setting1", "value1")
			setRuntimeConfig("roo-cline", "setting2", "value2")

			clearRuntimeConfig()

			expect(getRuntimeConfig("roo-cline.setting1")).toBeUndefined()
			expect(getRuntimeConfig("roo-cline.setting2")).toBeUndefined()
		})

		it("should return default value when no runtime config is set", () => {
			const config = new MockWorkspaceConfiguration("roo-cline", context)

			expect(config.get("nonexistent", 0)).toBe(0)
			expect(config.get("nonexistent", "default")).toBe("default")
		})

		it("should work with MockWorkspaceConfiguration.get() for CLI settings", () => {
			// Simulate CLI setting commandExecutionTimeout
			setRuntimeConfigValues("roo-cline", {
				commandExecutionTimeout: 20,
				commandTimeoutAllowlist: ["npm", "yarn"],
			})

			const config = new MockWorkspaceConfiguration("roo-cline", context)

			// These should return the runtime config values
			expect(config.get<number>("commandExecutionTimeout", 0)).toBe(20)
			expect(config.get<string[]>("commandTimeoutAllowlist", [])).toEqual(["npm", "yarn"])
		})
	})
})

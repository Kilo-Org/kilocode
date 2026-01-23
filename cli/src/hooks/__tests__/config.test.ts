/**
 * Tests for hooks configuration loading and merging
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { HooksConfig } from "../../config/types.js"

// Mock fs/promises
const mockReadFile = vi.fn()
const mockExistsSync = vi.fn()

vi.mock("fs/promises", () => ({
	readFile: (...args: unknown[]) => mockReadFile(...args),
}))

vi.mock("fs", () => ({
	existsSync: (...args: unknown[]) => mockExistsSync(...args),
}))

vi.mock("os", () => ({
	homedir: () => "/mock/home",
}))

vi.mock("../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Import after mocks
const { loadHooks, mergeHooksConfigs, getHooksForEvent, getProjectConfigPath, GLOBAL_CONFIG_FILE } = await import(
	"../config.js"
)

describe("Hooks Configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExistsSync.mockReturnValue(false)
		mockReadFile.mockResolvedValue("{}")
	})

	describe("getProjectConfigPath", () => {
		it("should return correct path for workspace", () => {
			const path = getProjectConfigPath("/my/workspace")
			expect(path).toBe("/my/workspace/.kilocode/cli/config.json")
		})
	})

	describe("GLOBAL_CONFIG_FILE", () => {
		it("should use home directory", () => {
			expect(GLOBAL_CONFIG_FILE).toBe("/mock/home/.kilocode/cli/config.json")
		})
	})

	describe("loadHooks", () => {
		it("should return empty hooks when no config files exist", async () => {
			mockExistsSync.mockReturnValue(false)

			const hooks = await loadHooks("/workspace")

			expect(hooks).toEqual({})
		})

		it("should load hooks from global config", async () => {
			mockExistsSync.mockImplementation((path: string) => path === GLOBAL_CONFIG_FILE)
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					hooks: {
						PreToolUse: [
							{
								matcher: "Bash",
								hooks: [{ type: "command", command: "echo test" }],
							},
						],
					},
				}),
			)

			const hooks = await loadHooks("/workspace")

			expect(hooks.PreToolUse).toHaveLength(1)
			expect(hooks.PreToolUse![0].matcher).toBe("Bash")
		})

		it("should load hooks from project config", async () => {
			const projectPath = "/workspace/.kilocode/cli/config.json"
			mockExistsSync.mockImplementation((path: string) => path === projectPath)
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					hooks: {
						PostToolUse: [
							{
								matcher: "Edit|Write",
								hooks: [{ type: "command", command: "prettier --write" }],
							},
						],
					},
				}),
			)

			const hooks = await loadHooks("/workspace")

			expect(hooks.PostToolUse).toHaveLength(1)
			expect(hooks.PostToolUse![0].matcher).toBe("Edit|Write")
		})

		it("should merge global and project hooks", async () => {
			mockExistsSync.mockReturnValue(true)

			// First call is global, second is project
			let callCount = 0
			mockReadFile.mockImplementation(() => {
				callCount++
				if (callCount === 1) {
					// Global config
					return JSON.stringify({
						hooks: {
							PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "global" }] }],
						},
					})
				} else {
					// Project config
					return JSON.stringify({
						hooks: {
							PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "project" }] }],
						},
					})
				}
			})

			const hooks = await loadHooks("/workspace")

			// Both matchers should be present
			expect(hooks.PreToolUse).toHaveLength(2)
		})

		it("should handle invalid JSON gracefully", async () => {
			mockExistsSync.mockReturnValue(true)
			mockReadFile.mockResolvedValue("not valid json")

			const hooks = await loadHooks("/workspace")

			expect(hooks).toEqual({})
		})

		it("should skip invalid hook entries", async () => {
			// Only mock global config file as existing
			mockExistsSync.mockImplementation((path: string) => path === GLOBAL_CONFIG_FILE)
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					hooks: {
						PreToolUse: [
							// Valid entry
							{ matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] },
							// Invalid: missing hooks array
							{ matcher: "Edit" },
							// Invalid: empty hooks array
							{ matcher: "Write", hooks: [] },
							// Invalid: wrong type
							{ matcher: "Read", hooks: [{ type: "invalid", command: "test" }] },
						],
					},
				}),
			)

			const hooks = await loadHooks("/workspace")

			// Only the valid entry should remain
			expect(hooks.PreToolUse).toHaveLength(1)
			expect(hooks.PreToolUse![0].matcher).toBe("Bash")
		})
	})

	describe("mergeHooksConfigs", () => {
		it("should merge two empty configs", () => {
			const merged = mergeHooksConfigs({}, {})
			expect(merged).toEqual({})
		})

		it("should preserve global hooks when project is empty", () => {
			const global: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "global" }] }],
			}

			const merged = mergeHooksConfigs(global, {})

			expect(merged.PreToolUse).toHaveLength(1)
			expect(merged.PreToolUse![0].hooks[0].command).toBe("global")
		})

		it("should preserve project hooks when global is empty", () => {
			const project: HooksConfig = {
				PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "project" }] }],
			}

			const merged = mergeHooksConfigs({}, project)

			expect(merged.PreToolUse).toHaveLength(1)
			expect(merged.PreToolUse![0].hooks[0].command).toBe("project")
		})

		it("should concatenate hooks from both configs", () => {
			const global: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "global" }] }],
			}
			const project: HooksConfig = {
				PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "project" }] }],
			}

			const merged = mergeHooksConfigs(global, project)

			expect(merged.PreToolUse).toHaveLength(2)
			// Global should come first
			expect(merged.PreToolUse![0].hooks[0].command).toBe("global")
			// Project should come second
			expect(merged.PreToolUse![1].hooks[0].command).toBe("project")
		})

		it("should merge different event types", () => {
			const global: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "pre" }] }],
			}
			const project: HooksConfig = {
				PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "post" }] }],
			}

			const merged = mergeHooksConfigs(global, project)

			expect(merged.PreToolUse).toHaveLength(1)
			expect(merged.PostToolUse).toHaveLength(1)
		})
	})

	describe("getHooksForEvent", () => {
		it("should return empty array for missing event", () => {
			const hooks: HooksConfig = {}
			const matchers = getHooksForEvent(hooks, "PreToolUse")
			expect(matchers).toEqual([])
		})

		it("should return matchers for existing event", () => {
			const hooks: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "test" }] }],
			}

			const matchers = getHooksForEvent(hooks, "PreToolUse")

			expect(matchers).toHaveLength(1)
			expect(matchers[0].matcher).toBe("Bash")
		})
	})
})

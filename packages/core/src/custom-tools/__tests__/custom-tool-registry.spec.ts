// pnpm --filter @roo-code/core test src/custom-tools/__tests__/custom-tool-registry.spec.ts

import path from "path"
import { fileURLToPath } from "url"

import { type CustomToolDefinition, parametersSchema as z } from "@roo-code/types"

import { CustomToolRegistry } from "../custom-tool-registry.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEST_FIXTURES_DIR = path.join(__dirname, "fixtures")
const TEST_FIXTURES_OVERRIDE_DIR = path.join(__dirname, "fixtures-override")

describe("CustomToolRegistry", () => {
	let registry: CustomToolRegistry

	beforeEach(() => {
		registry = new CustomToolRegistry()
	})

	describe("validation", () => {
		it("should accept a valid tool definition", () => {
			const validTool = {
				name: "valid_tool",
				description: "A valid tool",
				parameters: z.object({ name: z.string() }),
				execute: async () => "result",
			}

			expect(() => registry.register(validTool)).not.toThrow()
			expect(registry.has("valid_tool")).toBe(true)
		})

		it("should reject empty description", () => {
			const invalidTool = {
				name: "invalid_tool",
				description: "",
				parameters: z.object({}),
				execute: async () => "result",
			}

			expect(() => registry.register(invalidTool as CustomToolDefinition)).toThrow(/Invalid tool definition/)
		})

		it("should reject non-Zod parameters", () => {
			const invalidTool = {
				name: "bad_params_tool",
				description: "Tool with bad params",
				parameters: { foo: "bar" },
				execute: async () => "result",
			}

			expect(() => registry.register(invalidTool as unknown as CustomToolDefinition)).toThrow(
				/Invalid tool definition/,
			)
		})

		it("should allow missing parameters", () => {
			const toolWithoutParams = {
				name: "no_params_tool",
				description: "Tool without parameters",
				execute: async () => "result",
			}

			expect(() => registry.register(toolWithoutParams)).not.toThrow()
			expect(registry.has("no_params_tool")).toBe(true)
		})

		it("should reject empty name", () => {
			const invalidTool = {
				name: "",
				description: "Tool with empty name",
				execute: async () => "result",
			}

			expect(() => registry.register(invalidTool as CustomToolDefinition)).toThrow(/Invalid tool definition/)
		})

		it("should reject missing name", () => {
			const invalidTool = {
				description: "Tool without name",
				execute: async () => "result",
			}

			expect(() => registry.register(invalidTool as unknown as CustomToolDefinition)).toThrow(
				/Invalid tool definition/,
			)
		})
	})

	describe("register", () => {
		it("should register a valid tool", () => {
			const tool: CustomToolDefinition = {
				name: "test_tool",
				description: "Test tool",
				parameters: z.object({ input: z.string() }),
				execute: async (args: { input: string }) => `Processed: ${args.input}`,
			}

			registry.register(tool)

			expect(registry.has("test_tool")).toBe(true)
			expect(registry.size).toBe(1)
		})

		it("should throw for invalid tool definition", () => {
			const invalidTool = {
				name: "bad_tool",
				description: "",
				execute: async () => "result",
			}

			expect(() => registry.register(invalidTool as CustomToolDefinition)).toThrow(/Invalid tool definition/)
		})

		it("should overwrite existing tool with same id", () => {
			const tool1: CustomToolDefinition = {
				name: "tool",
				description: "First version",
				execute: async () => "v1",
			}

			const tool2: CustomToolDefinition = {
				name: "tool",
				description: "Second version",
				execute: async () => "v2",
			}

			registry.register(tool1)
			registry.register(tool2)

			expect(registry.size).toBe(1)
			expect(registry.get("tool")?.description).toBe("Second version")
		})
	})

	describe("unregister", () => {
		it("should remove a registered tool", () => {
			registry.register({
				name: "tool",
				description: "Test",
				execute: async () => "result",
			})

			const result = registry.unregister("tool")

			expect(result).toBe(true)
			expect(registry.has("tool")).toBe(false)
		})

		it("should return false for non-existent tool", () => {
			const result = registry.unregister("nonexistent")
			expect(result).toBe(false)
		})
	})

	describe("get", () => {
		it("should return registered tool", () => {
			registry.register({
				name: "my_tool",
				description: "My tool",
				execute: async () => "result",
			})

			const tool = registry.get("my_tool")

			expect(tool).toBeDefined()
			expect(tool?.name).toBe("my_tool")
			expect(tool?.description).toBe("My tool")
		})

		it("should return undefined for non-existent tool", () => {
			expect(registry.get("nonexistent")).toBeUndefined()
		})
	})

	describe("list", () => {
		it("should return all tool IDs", () => {
			registry.register({ name: "tool_a", description: "A", execute: async () => "a" })
			registry.register({ name: "tool_b", description: "B", execute: async () => "b" })
			registry.register({ name: "tool_c", description: "C", execute: async () => "c" })

			const ids = registry.list()

			expect(ids).toHaveLength(3)
			expect(ids).toContain("tool_a")
			expect(ids).toContain("tool_b")
			expect(ids).toContain("tool_c")
		})

		it("should return empty array when no tools registered", () => {
			expect(registry.list()).toEqual([])
		})
	})

	describe("getAll", () => {
		it("should return all tools as array", () => {
			registry.register({ name: "tool1", description: "Tool 1", execute: async () => "1" })
			registry.register({ name: "tool2", description: "Tool 2", execute: async () => "2" })

			const all = registry.getAll()

			expect(all).toHaveLength(2)
			expect(all.find((t) => t.name === "tool1")?.description).toBe("Tool 1")
			expect(all.find((t) => t.name === "tool2")?.description).toBe("Tool 2")
		})
	})

	describe("clear", () => {
		it("should remove all registered tools", () => {
			registry.register({ name: "tool1", description: "1", execute: async () => "1" })
			registry.register({ name: "tool2", description: "2", execute: async () => "2" })

			expect(registry.size).toBe(2)

			registry.clear()

			expect(registry.size).toBe(0)
			expect(registry.list()).toEqual([])
		})
	})

	describe.sequential("loadFromDirectory", () => {
		it("should load tools from TypeScript files", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("simple")
			expect(registry.has("simple")).toBe(true)
		}, 60000)

		it("should handle named exports", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("multi_toolA")
			expect(result.loaded).toContain("multi_toolB")
		}, 30000)

		it("should report validation failures", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			const invalidFailure = result.failed.find((f) => f.file === "invalid.ts")
			expect(invalidFailure).toBeDefined()
			expect(invalidFailure?.error).toContain("Invalid tool definition")
		}, 30000)

		it("should return empty results for non-existent directory", async () => {
			const result = await registry.loadFromDirectory("/nonexistent/path")

			expect(result.loaded).toHaveLength(0)
			expect(result.failed).toHaveLength(0)
		})

		it("should skip non-tool exports silently", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("mixed_validTool")
			// The non-tool exports should not appear in loaded or failed.
			expect(result.loaded).not.toContain("mixed_someString")
			expect(result.loaded).not.toContain("mixed_someNumber")
			expect(result.loaded).not.toContain("mixed_someObject")
		}, 30000)

		it("should support args as alias for parameters", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("legacy")

			const tool = registry.get("legacy")
			expect(tool?.parameters).toBeDefined()
		}, 30000)
	})

	describe.sequential("clearCache", () => {
		it("should clear the TypeScript compilation cache", async () => {
			await registry.loadFromDirectory(TEST_FIXTURES_DIR)
			registry.clearCache()

			// Should be able to load again without issues.
			registry.clear()
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("cached")
		}, 30000)
	})

	describe.sequential("loadFromDirectories", () => {
		it("should load tools from multiple directories", async () => {
			const result = await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Should load tools from both directories.
			expect(result.loaded).toContain("simple") // From both directories (override wins).
			expect(result.loaded).toContain("unique_override") // Only in override directory.
			expect(result.loaded).toContain("multi_toolA") // Only in fixtures directory.
		}, 60000)

		it("should allow later directories to override earlier ones", async () => {
			await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// The simple tool should have the overridden description.
			const simpleTool = registry.get("simple")
			expect(simpleTool).toBeDefined()
			expect(simpleTool?.description).toBe("Simple tool - OVERRIDDEN")
		}, 60000)

		it("should preserve order: first directory loaded first, second overrides", async () => {
			// Load in reverse order: override first, then fixtures.
			await registry.loadFromDirectories([TEST_FIXTURES_OVERRIDE_DIR, TEST_FIXTURES_DIR])

			// Now the original fixtures directory should win.
			const simpleTool = registry.get("simple")
			expect(simpleTool).toBeDefined()
			expect(simpleTool?.description).toBe("Simple tool") // Original wins when loaded second.
		}, 60000)

		it("should handle non-existent directories in the array", async () => {
			const result = await registry.loadFromDirectories([
				"/nonexistent/path",
				TEST_FIXTURES_DIR,
				"/another/nonexistent",
			])

			// Should still load from the existing directory.
			expect(result.loaded).toContain("simple")
			expect(result.failed).toHaveLength(1) // Only the invalid.ts from fixtures.
		}, 60000)

		it("should handle empty array", async () => {
			const result = await registry.loadFromDirectories([])

			expect(result.loaded).toHaveLength(0)
			expect(result.failed).toHaveLength(0)
		})

		it("should combine results from all directories", async () => {
			const result = await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Loaded should include tools from both (with duplicates since simple is loaded twice).
			// The "simple" tool is loaded from both directories.
			const simpleCount = result.loaded.filter((name) => name === "simple").length
			expect(simpleCount).toBe(2) // Listed twice in loaded results.
		}, 60000)
	})

	describe.sequential("loadFromDirectoriesIfStale", () => {
		it("should load tools from multiple directories when stale", async () => {
			const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			expect(result.loaded).toContain("simple")
			expect(result.loaded).toContain("unique_override")
		}, 60000)

		it("should not reload if directories are not stale", async () => {
			// First load.
			await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

			// Clear tools but keep staleness tracking.
			// (firstLoadSize is captured to document that tools were loaded, then cleared).
			const _firstLoadSize = registry.size
			registry.clear()

			// Second load - should return cached tool names without reloading.
			const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

			// Registry was cleared, not stale so no reload.
			expect(result.loaded).toEqual([])
		}, 30000)

		it("should handle mixed stale and non-stale directories", async () => {
			// Load from fixtures first.
			await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

			// Load from both - fixtures is not stale, override is new (stale).
			const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Override directory tools should be loaded (it's stale/new).
			expect(result.loaded).toContain("simple") // From override (stale).
			expect(result.loaded).toContain("unique_override") // From override (stale).
		}, 60000)
	})
})

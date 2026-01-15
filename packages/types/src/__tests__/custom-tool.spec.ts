import {
	type CustomToolDefinition,
	type CustomToolContext,
	defineCustomTool,
	parametersSchema as z,
} from "../custom-tool.js"
import type { TaskLike } from "../task.js"

describe("custom-tool utilities", () => {
	describe("z (Zod re-export)", () => {
		it("should export z from zod", () => {
			expect(z).toBeDefined()
			expect(z.string).toBeInstanceOf(Function)
			expect(z.object).toBeInstanceOf(Function)
			expect(z.number).toBeInstanceOf(Function)
		})

		it("should allow creating schemas", () => {
			const schema = z.object({
				name: z.string(),
				count: z.number().optional(),
			})

			const result = schema.parse({ name: "test" })
			expect(result).toEqual({ name: "test" })
		})
	})

	describe("defineCustomTool", () => {
		it("should return the same definition object", () => {
			const definition = {
				name: "test-tool",
				description: "Test tool",
				parameters: z.object({ input: z.string() }),
				execute: async (args: { input: string }) => `Result: ${args.input}`,
			}

			const result = defineCustomTool(definition)
			expect(result).toBe(definition)
		})

		it("should work without parameters", () => {
			const tool = defineCustomTool({
				name: "no-params-tool",
				description: "No params tool",
				execute: async () => "done",
			})

			expect(tool.description).toBe("No params tool")
			expect(tool.parameters).toBeUndefined()
		})

		it("should preserve type inference for execute args", async () => {
			const tool = defineCustomTool({
				name: "typed-tool",
				description: "Typed tool",
				parameters: z.object({
					name: z.string(),
					count: z.number(),
				}),
				execute: async (args) => {
					// TypeScript should infer args as { name: string, count: number }.
					return `Hello ${args.name}, count is ${args.count}`
				},
			})

			const context: CustomToolContext = {
				mode: "code",
				task: { taskId: "test-task-id" } as unknown as TaskLike,
			}

			const result = await tool.execute({ name: "World", count: 42 }, context)
			expect(result).toBe("Hello World, count is 42")
		})
	})

	describe("CustomToolDefinition type", () => {
		it("should accept valid definitions", () => {
			const def: CustomToolDefinition = {
				name: "valid-tool",
				description: "A valid tool",
				parameters: z.object({}),
				execute: async () => "result",
			}

			expect(def.description).toBe("A valid tool")
		})
	})
})

import type { ZodType, z } from "zod/v4"

import { TaskLike } from "./task.js"

// Re-export from Zod for convenience.

export { z as parametersSchema } from "zod/v4"

export type CustomToolParametersSchema = ZodType

export type SerializedCustomToolParameters = z.core.JSONSchema.JSONSchema

/**
 * Context provided to tool execute functions.
 */
export interface CustomToolContext {
	mode: string
	task: TaskLike
}

/**
 * Definition structure for a custom tool.
 *
 * Note: This interface uses simple types to avoid TypeScript performance issues
 * with Zod's complex type inference. For type-safe parameter inference, use
 * the `defineCustomTool` helper function instead of annotating with this interface.
 */
export interface CustomToolDefinition {
	/**
	 * The name of the tool.
	 * This is used to identify the tool in the prompt and in the tool registry.
	 */
	name: string

	/**
	 * A description of what the tool does.
	 * This is shown to the AI model to help it decide when to use the tool.
	 */
	description: string

	/**
	 * Optional Zod schema defining the tool's parameters.
	 * Use `z.object({})` to define the shape of arguments.
	 */
	parameters?: CustomToolParametersSchema

	/**
	 * The function that executes the tool.
	 *
	 * @param args - The validated arguments
	 * @param context - Execution context with session and message info
	 * @returns A string result to return to the AI
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	execute: (args: any, context: CustomToolContext) => Promise<string>
}

export interface SerializedCustomToolDefinition {
	name: string
	description: string
	parameters?: SerializedCustomToolParameters
	source?: string
}

/**
 * Type-safe definition structure for a custom tool with inferred parameter types.
 * Use this with `defineCustomTool` for full type inference.
 *
 * @template T - The Zod schema type for parameters
 */
export interface TypedCustomToolDefinition<T extends CustomToolParametersSchema>
	extends Omit<CustomToolDefinition, "execute" | "parameters"> {
	parameters?: T
	execute: (args: z.infer<T>, context: CustomToolContext) => Promise<string>
}

/**
 * Helper function to define a custom tool with proper type inference.
 *
 * This is optional - you can also just export a plain object that matches
 * the CustomToolDefinition interface.
 *
 * @example
 * ```ts
 * import { parametersSchema as z, defineCustomTool } from "@roo-code/types"
 *
 * export default defineCustomTool({
 *   name: "add_numbers",
 *   description: "Add two numbers",
 *   parameters: z.object({
 *     a: z.number().describe("First number"),
 *     b: z.number().describe("Second number"),
 *   }),
 *   async execute({ a, b }) {
 *     return `The sum is ${a + b}`
 *   }
 * })
 * ```
 */
export function defineCustomTool<T extends CustomToolParametersSchema>(
	definition: TypedCustomToolDefinition<T>,
): TypedCustomToolDefinition<T> {
	return definition
}

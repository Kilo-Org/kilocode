import type OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * Converts an OpenAI ChatCompletionTool to Anthropic's Tool format.
 *
 * OpenAI format wraps the tool definition in a `function` object with `parameters`,
 * while Anthropic uses a flatter structure with `input_schema`.
 *
 * @param tool - OpenAI ChatCompletionTool to convert
 * @returns Anthropic Tool definition
 *
 * @example
 * ```typescript
 * const openAITool = {
 *   type: "function",
 *   function: {
 *     name: "get_weather",
 *     description: "Get weather",
 *     parameters: { type: "object", properties: {...} }
 *   }
 * }
 *
 * const anthropicTool = convertOpenAIToolToAnthropic(openAITool)
 * // Returns: { name: "get_weather", description: "Get weather", input_schema: {...} }
 * ```
 */
export function convertOpenAIToolToAnthropic(tool: OpenAI.Chat.ChatCompletionTool): Anthropic.Tool {
	// Handle both ChatCompletionFunctionTool and ChatCompletionCustomTool
	if (tool.type !== "function") {
		throw new Error(`Unsupported tool type: ${tool.type}`)
	}

	return {
		name: tool.function.name,
		description: tool.function.description || "",
		input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
	}
}

/**
 * Converts an array of OpenAI ChatCompletionTools to Anthropic's Tool format.
 *
 * @param tools - Array of OpenAI ChatCompletionTools to convert
 * @returns Array of Anthropic Tool definitions
 */
export function convertOpenAIToolsToAnthropic(tools: OpenAI.Chat.ChatCompletionTool[]): Anthropic.Tool[] {
	return tools.map(convertOpenAIToolToAnthropic)
}

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

/**
 * Converts OpenAI tool_choice to Anthropic ToolChoice format.
 *
 * Maps OpenAI's tool_choice parameter to Anthropic's equivalent format:
 * - "none" → undefined (Anthropic doesn't have "none", just omit tools)
 * - "auto" → { type: "auto" }
 * - "required" → { type: "any" }
 * - { type: "function", function: { name } } → { type: "tool", name }
 *
 * @param toolChoice - OpenAI tool_choice parameter
 * @param parallelToolCalls - When true, allows parallel tool calls. When false (default), disables parallel tool calls.
 * @returns Anthropic ToolChoice or undefined if tools should be omitted
 *
 * @example
 * ```typescript
 * convertOpenAIToolChoiceToAnthropic("auto", false)
 * // Returns: { type: "auto", disable_parallel_tool_use: true }
 *
 * convertOpenAIToolChoiceToAnthropic({ type: "function", function: { name: "get_weather" } })
 * // Returns: { type: "tool", name: "get_weather", disable_parallel_tool_use: true }
 * ```
 */
export function convertOpenAIToolChoiceToAnthropic(
	toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
	parallelToolCalls?: boolean,
): Anthropic.Messages.MessageCreateParams["tool_choice"] | undefined {
	// Anthropic allows parallel tool calls by default. When parallelToolCalls is false or undefined,
	// we disable parallel tool use to ensure one tool call at a time.
	const disableParallelToolUse = !parallelToolCalls

	if (!toolChoice) {
		// Default to auto with parallel tool use control
		return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
	}

	if (typeof toolChoice === "string") {
		switch (toolChoice) {
			case "none":
				return undefined // Anthropic doesn't have "none", just omit tools
			case "auto":
				return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
			case "required":
				return { type: "any", disable_parallel_tool_use: disableParallelToolUse }
			default:
				return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
		}
	}

	// Handle object form { type: "function", function: { name: string } }
	if (typeof toolChoice === "object" && "function" in toolChoice) {
		return {
			type: "tool",
			name: toolChoice.function.name,
			disable_parallel_tool_use: disableParallelToolUse,
		}
	}

	return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
}

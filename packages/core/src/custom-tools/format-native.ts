import type { OpenAI } from "openai"

import type { SerializedCustomToolDefinition } from "@roo-code/types"

export function formatNative(tool: SerializedCustomToolDefinition): OpenAI.Chat.ChatCompletionFunctionTool {
	// Create a shallow copy to avoid mutating the input object
	let parameters = tool.parameters

	if (parameters) {
		// Create a new object with the modifications instead of mutating the original
		parameters = { ...parameters }

		// We don't need the $schema property; none of the other tools specify it.
		delete parameters["$schema"]

		// https://community.openai.com/t/on-the-function-calling-what-about-if-i-have-no-parameter-to-call/516876
		if (!parameters.required) {
			parameters.required = []
		}
	}

	return { type: "function", function: { ...tool, strict: true, parameters } }
}

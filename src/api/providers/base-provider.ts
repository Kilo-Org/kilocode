import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { ApiStream } from "../transform/stream"
import { countTokens } from "../../utils/countTokens"

/**
 * Base class for API providers that implements common functionality.
 */
export abstract class BaseProvider implements ApiHandler {
	abstract createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	abstract getModel(): { id: string; info: ModelInfo }

	/**
	 * Default token counting implementation using tiktoken.
	 * Providers can override this to use their native token counting endpoints.
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	async countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
		if (content.length === 0) {
			return 0
		}

		return countTokens(content, { useWorker: true })
	}

	/**
	 * Convert tool schemas to text format for token counting
	 */
	protected convertToolSchemasToText(toolSchemas: Anthropic.ToolUnion[]): string {
		if (toolSchemas.length === 0) {
			return ""
		}

		const toolsDescription = toolSchemas
			.map((tool) => {
				// Handle different tool types by accessing properties safely
				const toolName = tool.name
				let toolText = `Tool: ${toolName}\n`

				// Try to access description and input_schema properties
				if ("description" in tool) {
					toolText += `Description: ${tool.description}\n`
				}

				if ("input_schema" in tool && tool.input_schema && typeof tool.input_schema === "object") {
					toolText += `Parameters:\n${JSON.stringify(tool.input_schema, null, 2)}\n`
				}

				return toolText
			})
			.join("\n---\n")

		return `Available Tools:\n${toolsDescription}`
	}
}

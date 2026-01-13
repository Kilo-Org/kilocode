import { Anthropic } from "@anthropic-ai/sdk"
import { ConversationRole, Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime"

interface BedrockMessageContent {
	type: "text" | "image" | "video" | "tool_use" | "tool_result"
	text?: string
	source?: {
		type: "base64"
		data: string | Uint8Array // string for Anthropic, Uint8Array for Bedrock
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
	}
	// Video specific fields
	format?: string
	s3Location?: {
		uri: string
		bucketOwner?: string
	}
	// Tool use and result fields
	toolUseId?: string
	name?: string
	input?: any
	output?: any // Used for tool_result type
}

/**
 * Convert Anthropic messages to Bedrock Converse format
 * @param anthropicMessages Messages in Anthropic format
 * @param options Optional configuration for conversion
 * @param options.useNativeTools When true, keeps tool_use input as JSON object instead of XML string
 */
export function convertToBedrockConverseMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
	options?: { useNativeTools?: boolean },
): Message[] {
	const useNativeTools = options?.useNativeTools ?? false
	return anthropicMessages.map((anthropicMessage) => {
		// Map Anthropic roles to Bedrock roles
		const role: ConversationRole = anthropicMessage.role === "assistant" ? "assistant" : "user"

		if (typeof anthropicMessage.content === "string") {
			return {
				role,
				content: [
					{
						text: anthropicMessage.content,
					},
				] as ContentBlock[],
			}
		}

		// Process complex content types
		const content = anthropicMessage.content.map((block) => {
			const messageBlock = block as BedrockMessageContent & {
				id?: string
				tool_use_id?: string
				content?: string | Array<{ type: string; text: string }>
				output?: string | Array<{ type: string; text: string }>
			}

			if (messageBlock.type === "text") {
				return {
					text: messageBlock.text || "",
				} as ContentBlock
			}

			if (messageBlock.type === "image" && messageBlock.source) {
				// Convert base64 string to byte array if needed
				let byteArray: Uint8Array
				if (typeof messageBlock.source.data === "string") {
					const binaryString = atob(messageBlock.source.data)
					byteArray = new Uint8Array(binaryString.length)
					for (let i = 0; i < binaryString.length; i++) {
						byteArray[i] = binaryString.charCodeAt(i)
					}
				} else {
					byteArray = messageBlock.source.data
				}

				// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
				const format = messageBlock.source.media_type.split("/")[1]
				if (!["png", "jpeg", "gif", "webp"].includes(format)) {
					throw new Error(`Unsupported image format: ${format}`)
				}

				return {
					image: {
						format: format as "png" | "jpeg" | "gif" | "webp",
						source: {
							bytes: byteArray,
						},
					},
				} as ContentBlock
			}

			if (messageBlock.type === "tool_use") {
				if (useNativeTools) {
					// For native tool calling, keep input as JSON object for Bedrock's toolUse format
					return {
						toolUse: {
							toolUseId: messageBlock.id || "",
							name: messageBlock.name || "",
							input: messageBlock.input || {},
						},
					} as ContentBlock
				} else {
					// Convert tool use to XML text format for XML-based tool calling
					return {
						text: `<tool_use>\n<tool_name>${messageBlock.name}</tool_name>\n<tool_input>${JSON.stringify(messageBlock.input)}</tool_input>\n</tool_use>`,
					} as ContentBlock
				}
			}

			if (messageBlock.type === "tool_result") {
				// Handle content field - can be string or array
				if (messageBlock.content) {
					// Content is a string
					if (typeof messageBlock.content === "string") {
						return {
							toolResult: {
								toolUseId: messageBlock.tool_use_id || "",
								content: [
									{
										text: messageBlock.content,
									},
								],
								status: "success",
							},
						} as ContentBlock
					}
					// Content is an array of content blocks
					if (Array.isArray(messageBlock.content)) {
						return {
							toolResult: {
								toolUseId: messageBlock.tool_use_id || "",
								content: messageBlock.content.map((item) => ({
									text: typeof item === "string" ? item : item.text || String(item),
								})),
								status: "success",
							},
						} as ContentBlock
					}
				}

				// Fall back to output handling if content is not available
				if (messageBlock.output && typeof messageBlock.output === "string") {
					return {
						toolResult: {
							toolUseId: messageBlock.tool_use_id || "",
							content: [
								{
									text: messageBlock.output,
								},
							],
							status: "success",
						},
					} as ContentBlock
				}
				// Handle array of content blocks if output is an array
				if (Array.isArray(messageBlock.output)) {
					return {
						toolResult: {
							toolUseId: messageBlock.tool_use_id || "",
							content: messageBlock.output.map((part) => {
								if (typeof part === "object" && "text" in part) {
									return { text: part.text }
								}
								// Skip images in tool results as they're handled separately
								if (typeof part === "object" && "type" in part && part.type === "image") {
									return { text: "(see following message for image)" }
								}
								return { text: String(part) }
							}),
							status: "success",
						},
					} as ContentBlock
				}

				// Default case
				return {
					toolResult: {
						toolUseId: messageBlock.tool_use_id || "",
						content: [
							{
								text: String(messageBlock.output || ""),
							},
						],
						status: "success",
					},
				} as ContentBlock
			}

			if (messageBlock.type === "video") {
				const videoContent = messageBlock.s3Location
					? {
							s3Location: {
								uri: messageBlock.s3Location.uri,
								bucketOwner: messageBlock.s3Location.bucketOwner,
							},
						}
					: messageBlock.source

				return {
					video: {
						format: "mp4", // Default to mp4, adjust based on actual format if needed
						source: videoContent,
					},
				} as ContentBlock
			}

			// Default case for unknown block types
			return {
				text: "[Unknown Block Type]",
			} as ContentBlock
		})

		return {
			role,
			content,
		}
	})
}

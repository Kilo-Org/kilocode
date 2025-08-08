import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

/* Removes image blocks from messages if they are not supported by the Api Handler */
// kilocode_change: made function async for await fetchModel
export async function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): Promise<ApiMessage[]> {
	const supportsImages = (await apiHandler.fetchModel()).info.supportsImages
	return messages.map((message) => {
		// Handle array content (could contain image blocks).
		let { content } = message
		if (Array.isArray(content)) {
			// kilocode_todo: await fetchModel
			if (!supportsImages) {
				// Convert image blocks to text descriptions.
				content = content.map((block) => {
					if (block.type === "image") {
						// Convert image blocks to text descriptions.
						// Note: We can't access the actual image content/url due to API limitations,
						// but we can indicate that an image was present in the conversation.
						return {
							type: "text",
							text: "[Referenced image in conversation]",
						}
					}
					return block
				})
			}
		}
		return { ...message, content }
	})
}

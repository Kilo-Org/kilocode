import { ChatMessage } from "../index.js"
import { renderChatMessage } from "../util/messageContent.js"
import { matchLine } from "../../../ghost/utils/text-utils.js"

export type LineStream = AsyncGenerator<string>

// Re-export matchLine for backward compatibility
export { matchLine }

/**
 * Convert a stream of arbitrary chunks to a stream of lines
 */
export async function* streamLines(
	streamCompletion: AsyncGenerator<string | ChatMessage>,
	log: boolean = false,
): LineStream {
	const allLines = []

	let buffer = ""

	try {
		for await (const update of streamCompletion) {
			const chunk = typeof update === "string" ? update : renderChatMessage(update)
			buffer += chunk
			const lines = buffer.split("\n")
			buffer = lines.pop() ?? ""
			for (const line of lines) {
				yield line
				allLines.push(line)
			}

			// if (buffer === "" && chunk.endsWith("\n")) {
			//   yield "";
			//   allLines.push("");
			// }
		}
		if (buffer.length > 0) {
			yield buffer
			allLines.push(buffer)
		}
	} finally {
		if (log) {
			console.log("Streamed lines: ", allLines.join("\n"))
		}
	}
}

export async function* generateLines<T>(lines: T[]): AsyncGenerator<T> {
	for (const line of lines) {
		yield line
		// await new Promise((resolve, reject) => setTimeout(() => resolve(null), 50));
	}
}

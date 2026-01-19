/**
 * Hook to handle JSON messages from stdin in jsonInteractive mode.
 * This enables bidirectional communication with the Agent Manager.
 */

import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { createInterface } from "readline"
import { sendAskResponseAtom, sendTaskAtom, cancelTaskAtom, respondToToolAtom } from "../atoms/actions.js"
import { logs } from "../../services/logs.js"
import { processImagePaths } from "../../media/images.js"

/**
 * Check if a string is a data URL (starts with "data:")
 */
function isDataUrl(str: string): boolean {
	return str.startsWith("data:")
}

/**
 * Convert image paths to data URLs if needed.
 * If images are already data URLs, they are passed through unchanged.
 * If images are file paths, they are read and converted to data URLs.
 *
 * @param images Array of image paths or data URLs
 * @returns Array of data URLs (or undefined if no valid images)
 */
async function convertImagesToDataUrls(images: string[] | undefined): Promise<string[] | undefined> {
	if (!images || images.length === 0) {
		return undefined
	}

	// Separate data URLs from file paths
	const dataUrls: string[] = []
	const filePaths: string[] = []

	for (const image of images) {
		if (isDataUrl(image)) {
			dataUrls.push(image)
		} else {
			filePaths.push(image)
		}
	}

	// If all images are already data URLs, return them directly
	if (filePaths.length === 0) {
		return dataUrls.length > 0 ? dataUrls : undefined
	}

	// Convert file paths to data URLs
	const result = await processImagePaths(filePaths)

	if (result.errors.length > 0) {
		for (const error of result.errors) {
			logs.error(`Failed to load image "${error.path}": ${error.error}`, "useStdinJsonHandler")
		}
	}

	// Combine existing data URLs with newly converted ones
	const allDataUrls = [...dataUrls, ...result.images]
	return allDataUrls.length > 0 ? allDataUrls : undefined
}

export interface StdinMessage {
	type: string
	askResponse?: string
	text?: string
	images?: string[]
	approved?: boolean
}

export interface StdinMessageHandlers {
	sendAskResponse: (params: { response: "messageResponse"; text?: string; images?: string[] }) => Promise<void>
	sendTask: (params: { text: string; images?: string[] }) => Promise<void>
	cancelTask: () => Promise<void>
	respondToTool: (params: {
		response: "yesButtonClicked" | "noButtonClicked"
		text?: string
		images?: string[]
	}) => Promise<void>
}

/**
 * Handles a parsed stdin message by calling the appropriate handler.
 * Exported for testing purposes.
 *
 * Images can be provided as either:
 * - Data URLs (e.g., "data:image/png;base64,...")
 * - File paths (e.g., "/tmp/image.png" or "./screenshot.png")
 *
 * File paths are automatically converted to data URLs before being sent.
 */
export async function handleStdinMessage(
	message: StdinMessage,
	handlers: StdinMessageHandlers,
): Promise<{ handled: boolean; error?: string }> {
	switch (message.type) {
		case "newTask": {
			// Start a new task with prompt and optional images
			// This allows the Agent Manager to send the initial prompt via stdin
			// instead of CLI args, enabling images to be included with the first message
			// Images are converted from file paths to data URLs if needed
			const images = await convertImagesToDataUrls(message.images)
			await handlers.sendTask({
				text: message.text || "",
				...(images && { images }),
			})
			return { handled: true }
		}

		case "askResponse": {
			// Handle ask response (user message, approval response, etc.)
			// Images are converted from file paths to data URLs if needed
			const images = await convertImagesToDataUrls(message.images)
			if (message.askResponse === "yesButtonClicked" || message.askResponse === "noButtonClicked") {
				await handlers.respondToTool({
					response: message.askResponse,
					...(message.text !== undefined && { text: message.text }),
					...(images && { images }),
				})
			} else {
				await handlers.sendAskResponse({
					response: (message.askResponse as "messageResponse") ?? "messageResponse",
					...(message.text !== undefined && { text: message.text }),
					...(images && { images }),
				})
			}
			return { handled: true }
		}

		case "cancelTask":
			await handlers.cancelTask()
			return { handled: true }

		case "respondToApproval":
			// Handle approval response (yes/no for tool use)
			// This is a convenience API that maps approved: boolean to the internal response format
			if (message.approved) {
				await handlers.respondToTool({
					response: "yesButtonClicked",
					...(message.text !== undefined && { text: message.text }),
				})
			} else {
				await handlers.respondToTool({
					response: "noButtonClicked",
					...(message.text !== undefined && { text: message.text }),
				})
			}
			return { handled: true }

		default:
			return { handled: false, error: `Unknown message type: ${message.type}` }
	}
}

export function useStdinJsonHandler(enabled: boolean) {
	const sendAskResponse = useSetAtom(sendAskResponseAtom)
	const sendTask = useSetAtom(sendTaskAtom)
	const cancelTask = useSetAtom(cancelTaskAtom)
	const respondToTool = useSetAtom(respondToToolAtom)

	useEffect(() => {
		if (!enabled) {
			return
		}

		logs.debug("Starting stdin JSON handler", "useStdinJsonHandler")

		const rl = createInterface({
			input: process.stdin,
			terminal: false,
		})

		const handlers: StdinMessageHandlers = {
			sendAskResponse: async (params) => {
				await sendAskResponse(params)
			},
			sendTask: async (params) => {
				await sendTask(params)
			},
			cancelTask: async () => {
				await cancelTask()
			},
			respondToTool: async (params) => {
				await respondToTool(params)
			},
		}

		const handleLine = async (line: string) => {
			const trimmed = line.trim()
			if (!trimmed) return

			try {
				const message: StdinMessage = JSON.parse(trimmed)
				logs.debug("Received stdin message", "useStdinJsonHandler", { type: message.type })

				const result = await handleStdinMessage(message, handlers)
				if (!result.handled) {
					logs.warn("Unknown stdin message type", "useStdinJsonHandler", { type: message.type })
				}
			} catch (error) {
				logs.error("Failed to parse stdin JSON", "useStdinJsonHandler", {
					error: error instanceof Error ? error.message : String(error),
					line: trimmed.slice(0, 100),
				})
			}
		}

		rl.on("line", handleLine)

		rl.on("close", () => {
			logs.debug("Stdin closed", "useStdinJsonHandler")
		})

		rl.on("error", (error) => {
			logs.error("Stdin error", "useStdinJsonHandler", {
				error: error instanceof Error ? error.message : String(error),
			})
		})

		return () => {
			rl.close()
		}
	}, [enabled, sendAskResponse, sendTask, cancelTask, respondToTool])
}

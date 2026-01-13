/**
 * Hook to handle JSON messages from stdin in jsonInteractive mode.
 * This enables bidirectional communication with the Agent Manager.
 */

import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { createInterface } from "readline"
import { sendAskResponseAtom, cancelTaskAtom, respondToToolAtom } from "../atoms/actions.js"
import { logs } from "../../services/logs.js"

export interface StdinMessage {
	type: string
	askResponse?: string
	text?: string
	images?: string[]
	approved?: boolean
}

export interface StdinMessageHandlers {
	sendAskResponse: (params: { response: "messageResponse"; text?: string; images?: string[] }) => Promise<void>
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
 */
export async function handleStdinMessage(
	message: StdinMessage,
	handlers: StdinMessageHandlers,
): Promise<{ handled: boolean; error?: string }> {
	switch (message.type) {
		case "askResponse":
			// Handle ask response (user message, approval response, etc.)
			if (message.askResponse === "yesButtonClicked" || message.askResponse === "noButtonClicked") {
				await handlers.respondToTool({
					response: message.askResponse,
					...(message.text !== undefined && { text: message.text }),
					...(message.images !== undefined && { images: message.images }),
				})
			} else {
				await handlers.sendAskResponse({
					response: (message.askResponse as "messageResponse") ?? "messageResponse",
					...(message.text !== undefined && { text: message.text }),
					...(message.images !== undefined && { images: message.images }),
				})
			}
			return { handled: true }

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
	}, [enabled, sendAskResponse, cancelTask, respondToTool])
}

/**
 * Hook to handle JSON messages from stdin in jsonInteractive mode.
 * This enables bidirectional communication with the Agent Manager.
 */

import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { createInterface } from "readline"
import { sendAskResponseAtom, cancelTaskAtom, respondToToolAtom } from "../atoms/actions.js"
import { logs } from "../../services/logs.js"

interface StdinMessage {
	type: string
	askResponse?: string
	text?: string
	images?: string[]
	approved?: boolean
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

		const handleLine = async (line: string) => {
			const trimmed = line.trim()
			if (!trimmed) return

			try {
				const message: StdinMessage = JSON.parse(trimmed)
				logs.debug("Received stdin message", "useStdinJsonHandler", { type: message.type })

				switch (message.type) {
					case "askResponse":
						// Handle ask response (user message, approval response, etc.)
						if (message.askResponse === "yesButtonClicked" || message.askResponse === "noButtonClicked") {
							await respondToTool({
								response: message.askResponse,
								...(message.text !== undefined && { text: message.text }),
								...(message.images !== undefined && { images: message.images }),
							})
						} else {
							await sendAskResponse({
								response: (message.askResponse as "messageResponse") || "messageResponse",
								...(message.text !== undefined && { text: message.text }),
								...(message.images !== undefined && { images: message.images }),
							})
						}
						break

					case "cancelTask":
						logs.debug("Canceling task via stdin", "useStdinJsonHandler")
						await cancelTask()
						break

					case "respondToApproval":
						// Handle approval response (yes/no for tool use)
						if (message.approved) {
							await respondToTool({
								response: "yesButtonClicked",
								...(message.text !== undefined && { text: message.text }),
							})
						} else {
							await respondToTool({
								response: "noButtonClicked",
								...(message.text !== undefined && { text: message.text }),
							})
						}
						break

					default:
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

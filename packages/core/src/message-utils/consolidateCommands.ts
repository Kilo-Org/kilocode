import type { ClineMessage } from "@roo-code/types"

import { safeJsonParse } from "./safeJsonParse.js"

export const COMMAND_OUTPUT_STRING = "Output:"

/**
 * Consolidates sequences of command and command_output messages in an array of ClineMessages.
 * Also consolidates sequences of use_mcp_server and mcp_server_response messages.
 *
 * This function processes an array of ClineMessages objects, looking for sequences
 * where a 'command' message is followed by one or more 'command_output' messages,
 * or where a 'use_mcp_server' message is followed by one or more 'mcp_server_response' messages.
 * When such a sequence is found, it consolidates them into a single message, merging
 * their text contents.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with command and MCP sequences consolidated.
 *
 * @example
 * const messages: ClineMessage[] = [
 *   { type: 'ask', ask: 'command', text: 'ls', ts: 1625097600000 },
 *   { type: 'ask', ask: 'command_output', text: 'file1.txt', ts: 1625097601000 },
 *   { type: 'ask', ask: 'command_output', text: 'file2.txt', ts: 1625097602000 }
 * ];
 * const result = consolidateCommands(messages);
 * // Result: [{ type: 'ask', ask: 'command', text: 'ls\nfile1.txt\nfile2.txt', ts: 1625097600000 }]
 */
export function consolidateCommands(messages: ClineMessage[]): ClineMessage[] {
	const consolidatedMessages = new Map<number, ClineMessage>()
	const processedIndices = new Set<number>()

	// Single pass through all messages
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) continue

		// Handle MCP server requests
		if (msg.type === "ask" && msg.ask === "use_mcp_server") {
			// Look ahead for MCP responses
			const responses: string[] = []
			let j = i + 1

			while (j < messages.length) {
				const nextMsg = messages[j]
				if (!nextMsg) {
					j++
					continue
				}
				if (nextMsg.say === "mcp_server_response") {
					responses.push(nextMsg.text || "")
					processedIndices.add(j)
					j++
				} else if (nextMsg.type === "ask" && nextMsg.ask === "use_mcp_server") {
					// Stop if we encounter another MCP request
					break
				} else {
					j++
				}
			}

			if (responses.length > 0) {
				// Parse the JSON from the message text
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const jsonObj = safeJsonParse<any>(msg.text || "{}", {})

				// Add the response to the JSON object
				jsonObj.response = responses.join("\n")

				// Stringify the updated JSON object
				const consolidatedText = JSON.stringify(jsonObj)

				consolidatedMessages.set(msg.ts, { ...msg, text: consolidatedText })
			} else {
				// If there's no response, just keep the original message
				consolidatedMessages.set(msg.ts, { ...msg })
			}
		}
		// Handle command sequences
		else if (msg.type === "ask" && msg.ask === "command") {
			let consolidatedText = msg.text || ""
			let j = i + 1
			let previous: { type: "ask" | "say"; text: string } | undefined
			let lastProcessedIndex = i

			while (j < messages.length) {
				const currentMsg = messages[j]
				if (!currentMsg) {
					j++
					continue
				}
				const { type, ask, say, text = "" } = currentMsg

				if (type === "ask" && ask === "command") {
					break // Stop if we encounter the next command.
				}

				if (ask === "command_output" || say === "command_output") {
					if (!previous) {
						consolidatedText += `\n${COMMAND_OUTPUT_STRING}`
					}

					const isDuplicate = previous && previous.type !== type && previous.text === text

					if (text.length > 0 && !isDuplicate) {
						// Add a newline before adding the text if there's already content
						if (
							previous &&
							consolidatedText.length >
								consolidatedText.indexOf(COMMAND_OUTPUT_STRING) + COMMAND_OUTPUT_STRING.length
						) {
							consolidatedText += "\n"
						}
						consolidatedText += text
					}

					previous = { type, text }
					processedIndices.add(j)
					lastProcessedIndex = j
				}

				j++
			}

			consolidatedMessages.set(msg.ts, { ...msg, text: consolidatedText })

			// Only skip ahead if we actually processed command outputs
			if (lastProcessedIndex > i) {
				i = lastProcessedIndex
			}
		}
	}

	// Build final result: filter out processed messages and use consolidated versions
	const result: ClineMessage[] = []
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) continue

		// Skip messages that were processed as outputs/responses
		if (processedIndices.has(i)) {
			continue
		}

		// Skip command_output and mcp_server_response messages
		if (msg.ask === "command_output" || msg.say === "command_output" || msg.say === "mcp_server_response") {
			continue
		}

		// Use consolidated version if available
		const consolidatedMsg = consolidatedMessages.get(msg.ts)
		if (consolidatedMsg) {
			result.push(consolidatedMsg)
		} else {
			result.push(msg)
		}
	}

	return result
}

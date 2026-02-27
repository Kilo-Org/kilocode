import type { KiloConnectionService } from "../services/cli-backend/index.js"
import type { SSEEvent } from "../services/cli-backend/types.js"
import { BenchCreditError } from "./types.js"
import type { BenchApiHandler, BenchStreamChunk } from "./types.js"

/**
 * Adapts the upstream CLI backend's session/message system to the BenchApiHandler interface.
 * Creates temporary sessions, sends messages, and collects SSE streamed responses.
 *
 * @param textOnly  When true (default), all tools are disabled via `tools: { "*": false }`
 *                  so the backend produces text-only responses (used for generation/evaluation).
 *                  When false, models have full tool access for executional benchmarking
 *                  (should only be used with an isolated workspace directory).
 */
export function createBenchApiHandler(
	connectionService: KiloConnectionService,
	workspaceDir: string,
	defaultModelId: string,
	defaultProviderId: string,
	options?: { textOnly?: boolean },
): BenchApiHandler {
	const textOnly = options?.textOnly ?? true

	return {
		getModelId(): string {
			return defaultModelId
		},

		async *createMessage(
			systemPrompt: string,
			userPrompt: string,
			modelId?: string,
		): AsyncIterable<BenchStreamChunk> {
			const httpClient = connectionService.getHttpClient()
			if (!httpClient) {
				throw new Error("CLI backend not connected")
			}

			// Create a temporary session for this bench call
			const session = await httpClient.createSession(workspaceDir)
			const sessionId = session.id
			console.log(`[Kilo Bench] Created session ${sessionId} (textOnly: ${textOnly})`)

			try {
				const chunks: BenchStreamChunk[] = []
				let resolveWaiting: (() => void) | null = null
				let done = false
				let messageError: string | null = null
				let messageSent = false
				let receivedAnyEvent = false

				const unsubscribe = connectionService.onEventFiltered(
					(event: SSEEvent) => {
						if (event.type === "message.part.delta") {
							return event.properties.sessionID === sessionId
						}
						if (event.type === "message.updated") {
							return event.properties.info.sessionID === sessionId
						}
						if (event.type === "session.idle") {
							return event.properties.sessionID === sessionId
						}
						return false
					},
					(event: SSEEvent) => {
						console.log(`[Kilo Bench] SSE event: ${event.type} (session: ${sessionId}, messageSent: ${messageSent})`)

						if (event.type === "message.part.delta") {
							receivedAnyEvent = true
							if (event.properties.field === "text") {
								chunks.push({ type: "text", text: event.properties.delta })
								resolveWaiting?.()
							}
						} else if (event.type === "message.updated") {
							receivedAnyEvent = true
							const info = event.properties.info
							console.log(`[Kilo Bench] message.updated: role=${info.role}, hasTokens=${!!info.tokens}, hasError=${!!info.error}`)
							if (info.role === "assistant" && info.tokens) {
								chunks.push({
									type: "usage",
									inputTokens: info.tokens.input || 0,
									outputTokens: info.tokens.output || 0,
									totalCost: info.cost || 0,
								})
							}
							if (info.error) {
								const errName = info.error.name || "Unknown error"
								const errData = info.error.data ? JSON.stringify(info.error.data) : ""
								const errMsg = errData || errName
								const errLower = errMsg.toLowerCase()
								const nameLower = errName.toLowerCase()
								console.log(`[Kilo Bench] Error from backend: ${errName} - ${errData}`)
								if (
									nameLower.includes("credit") || nameLower.includes("billing") ||
									nameLower.includes("insufficient") || nameLower.includes("quota") ||
									errLower.includes("credit") || errLower.includes("insufficient") ||
									errLower.includes("billing") || errLower.includes("quota") ||
									errLower.includes("rate limit") || errLower.includes("payment")
								) {
									messageError = `CREDIT_ERROR:${errMsg}`
								} else {
									messageError = errMsg
								}
								// An error is also a terminal event
								done = true
								resolveWaiting?.()
							}
						} else if (event.type === "session.idle") {
							// Only treat session.idle as "done" if we've already sent the message
							// AND received at least one message event (or the message has had time to process)
							if (messageSent && receivedAnyEvent) {
								console.log(`[Kilo Bench] session.idle — marking done (received events)`)
								done = true
								resolveWaiting?.()
							} else if (messageSent) {
								// Got idle but no events yet — could be a race. Wait a bit and check again.
								console.log(`[Kilo Bench] session.idle but no events yet — delaying`)
								setTimeout(() => {
									if (!receivedAnyEvent && messageSent) {
										console.log(`[Kilo Bench] Still no events after delay — marking done (backend returned nothing)`)
										done = true
										resolveWaiting?.()
									}
								}, 2000)
							} else {
								console.log(`[Kilo Bench] session.idle before message sent — ignoring`)
							}
						}
					},
				)

				// Send the message (system prompt prepended to user prompt)
				const fullPrompt = systemPrompt
					? `[System: ${systemPrompt}]\n\n${userPrompt}`
					: userPrompt

				const targetModel = modelId || defaultModelId
				const targetProvider = defaultProviderId

				console.log(`[Kilo Bench] Sending message to ${targetModel || "(user default)"} (prompt length: ${fullPrompt.length})`)

				const sendOptions: {
					providerID?: string
					modelID?: string
					tools?: Record<string, boolean>
				} = {}

				// In text-only mode, disable all tools so the model can't
				// execute agent actions (file I/O, bash, etc.)
				if (textOnly) {
					sendOptions.tools = { "*": false }
				}

				if (targetModel) {
					sendOptions.providerID = targetProvider
					sendOptions.modelID = targetModel
				}

				await httpClient.sendMessage(
					sessionId,
					[{ type: "text", text: fullPrompt }],
					workspaceDir,
					sendOptions,
				)

				messageSent = true
				console.log(`[Kilo Bench] Message sent successfully`)

				// Yield chunks as they arrive
				try {
					while (!done) {
						if (chunks.length > 0) {
							const batch = chunks.splice(0, chunks.length)
							for (const chunk of batch) {
								yield chunk
							}
						} else {
							await new Promise<void>((resolve) => {
								resolveWaiting = resolve
								setTimeout(() => {
									resolveWaiting = null
									resolve()
								}, 60000)
							})
						}
					}

					// Flush remaining chunks
					for (const chunk of chunks) {
						yield chunk
					}

					if (messageError) {
						const errStr = messageError as string
						if (errStr.startsWith("CREDIT_ERROR:")) {
							throw new BenchCreditError(errStr.slice("CREDIT_ERROR:".length))
						}
						throw new Error(errStr)
					}

					console.log(`[Kilo Bench] Stream complete. Total text chunks: ${chunks.length}`)
				} finally {
					unsubscribe()
				}
			} finally {
				try {
					await httpClient.deleteSession(sessionId, workspaceDir)
					console.log(`[Kilo Bench] Cleaned up session ${sessionId}`)
				} catch {
					// Best effort cleanup
				}
			}
		},
	}
}

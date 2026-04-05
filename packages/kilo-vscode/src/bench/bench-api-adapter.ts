import type { KiloConnectionService } from "../services/cli-backend/index.js"
import type { Event, KiloClient } from "@kilocode/sdk/v2/client"
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
	const getClient = (): KiloClient => {
		try {
			return connectionService.getClient()
		} catch {
			throw new Error("CLI backend not connected")
		}
	}
	const toFailure = (value: string): string =>
		value.toLowerCase().includes("credit") ||
			value.toLowerCase().includes("billing") ||
			value.toLowerCase().includes("insufficient") ||
			value.toLowerCase().includes("quota") ||
			value.toLowerCase().includes("rate limit") ||
			value.toLowerCase().includes("payment")
			? `CREDIT_ERROR:${value}`
			: value

	return {
		getModelId(): string {
			return defaultModelId
		},

		async *createMessage(
			systemPrompt: string,
			userPrompt: string,
			modelId?: string,
		): AsyncIterable<BenchStreamChunk> {
			const client = getClient()

			const { data: session } = await client.session.create(
				{ directory: workspaceDir, platform: "kilo" },
				{ throwOnError: true },
			)
			const sessionId = session.id
			console.log(`[Kilo Bench] Created session ${sessionId} (textOnly: ${textOnly})`)

			try {
				const chunks: BenchStreamChunk[] = []
				let resolveWaiting: (() => void) | null = null
				let idleTimer: ReturnType<typeof setTimeout> | null = null
				let waitTimer: ReturnType<typeof setTimeout> | null = null
				let done = false
				let closed = false
				let messageError: string | null = null
				let messageSent = false
				let receivedAnyEvent = false
				let totalTextChunks = 0
				let lastEventAt = Date.now()
				const maxInactivityMs = 3 * 60 * 1000

				const clearIdleTimer = () => {
					if (!idleTimer) return
					clearTimeout(idleTimer)
					idleTimer = null
				}

				const clearWaitTimer = () => {
					if (!waitTimer) return
					clearTimeout(waitTimer)
					waitTimer = null
				}

				const wake = () => {
					const fn = resolveWaiting
					resolveWaiting = null
					clearWaitTimer()
					fn?.()
				}

				const unsubscribe = connectionService.onEventFiltered(
					(event: Event) => {
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
					(event: Event) => {
						if (closed) {
							return
						}
						lastEventAt = Date.now()
						console.log(`[Kilo Bench] SSE event: ${event.type} (session: ${sessionId}, messageSent: ${messageSent})`)

						if (event.type === "message.part.delta") {
							receivedAnyEvent = true
							clearIdleTimer()
							if (event.properties.field === "text") {
								totalTextChunks++
								chunks.push({ type: "text", text: event.properties.delta })
								wake()
							}
							return
						}

						if (event.type === "message.updated") {
							receivedAnyEvent = true
							clearIdleTimer()
							const info = event.properties.info
							const tokens = "tokens" in info ? info.tokens : undefined
							const error = "error" in info ? info.error : undefined
							const cost = "cost" in info ? info.cost : undefined
							console.log(`[Kilo Bench] message.updated: role=${info.role}, hasTokens=${!!tokens}, hasError=${!!error}`)
							if (info.role === "assistant" && tokens) {
								chunks.push({
									type: "usage",
									inputTokens: tokens.input || 0,
									outputTokens: tokens.output || 0,
									totalCost: cost || 0,
								})
							}
							if (error) {
								const errName = error.name || "Unknown error"
								const errData = error.data ? JSON.stringify(error.data) : ""
								const errMsg = errData || errName
								console.log(`[Kilo Bench] Error from backend: ${errName} - ${errData}`)
								messageError = toFailure(errMsg)
								done = true
								wake()
							}
							return
						}

						if (event.type === "session.idle") {
							if (messageSent && receivedAnyEvent) {
								console.log(`[Kilo Bench] session.idle — marking done (received events)`)
								done = true
								wake()
								return
							}
							if (messageSent) {
								console.log(`[Kilo Bench] session.idle but no events yet — delaying`)
								clearIdleTimer()
								idleTimer = setTimeout(() => {
									if (!closed && !receivedAnyEvent && messageSent) {
										console.log(`[Kilo Bench] Still no events after delay — marking done (backend returned nothing)`)
										done = true
										wake()
									}
								}, 2000)
								return
							}
							console.log(`[Kilo Bench] session.idle before message sent — ignoring`)
						}
					},
				)

				const targetModel = modelId || defaultModelId
				const hasExplicitModel = targetModel.length > 0 && targetModel !== "default"
				const targetProvider = defaultProviderId
				console.log(`[Kilo Bench] Sending message to ${hasExplicitModel ? targetModel : "(user default)"} (prompt length: ${userPrompt.length})`)

				const sendOptions: {
					system?: string
					tools?: Record<string, boolean>
				} = {}

				if (textOnly) {
					sendOptions.tools = { "*": false }
				}
				if (systemPrompt) {
					sendOptions.system = systemPrompt
				}

				const prompt = client.session.prompt(
					{
						sessionID: sessionId,
						directory: workspaceDir,
						parts: [{ type: "text", text: userPrompt }],
						model: hasExplicitModel
							? {
								providerID: targetProvider,
								modelID: targetModel,
							}
							: undefined,
						system: sendOptions.system,
						tools: sendOptions.tools,
					},
					{ throwOnError: true },
				)
				messageSent = true
				lastEventAt = Date.now()
				console.log(`[Kilo Bench] Message sent successfully`)
				void prompt.catch((err: unknown) => {
					if (closed) {
						return
					}
					const msg = err instanceof Error ? err.message : String(err)
					messageError = toFailure(msg)
					done = true
					wake()
				})

				try {
					while (!done) {
						if (chunks.length > 0) {
							const batch = chunks.splice(0, chunks.length)
							for (const chunk of batch) {
								yield chunk
							}
							continue
						}

						await new Promise<void>((resolve) => {
							resolveWaiting = () => {
								resolveWaiting = null
								clearWaitTimer()
								resolve()
							}
							waitTimer = setTimeout(() => {
								if (Date.now() - lastEventAt >= maxInactivityMs) {
									done = true
									messageError = "Timed out waiting for model response"
								}
								if (resolveWaiting) {
									resolveWaiting()
									return
								}
								resolve()
							}, 60000)
						})
					}

					for (const chunk of chunks) {
						yield chunk
					}

					const err = messageError as string | null
					if (err) {
						if (err.startsWith("CREDIT_ERROR:")) {
							throw new BenchCreditError(err.slice("CREDIT_ERROR:".length))
						}
						throw new Error(err)
					}

					console.log(`[Kilo Bench] Stream complete. Total text chunks: ${totalTextChunks}`)
				} finally {
					closed = true
					done = true
					clearIdleTimer()
					wake()
					unsubscribe()
				}
			} finally {
				try {
					await client.session.delete({ sessionID: sessionId, directory: workspaceDir }, { throwOnError: true })
					console.log(`[Kilo Bench] Cleaned up session ${sessionId}`)
				} catch (err) {
					console.warn(`[Kilo Bench] Failed to clean up session ${sessionId}:`, err)
				}
			}
		},
	}
}

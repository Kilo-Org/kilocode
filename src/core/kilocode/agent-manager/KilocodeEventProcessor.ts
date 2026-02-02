import type { KilocodeStreamEvent, KilocodePayload } from "./CliOutputParser"
import type { ClineMessage } from "@roo-code/types"
import { RuntimeProcessHandler } from "./RuntimeProcessHandler"
import { AgentRegistry } from "./AgentRegistry"

/**
 * State event payload sent to webview for state machine transitions.
 */
export interface StateEventPayload {
	eventType: string
	partial?: boolean
}

interface Dependencies {
	processHandler: RuntimeProcessHandler
	registry: AgentRegistry
	sessionMessages: Map<string, ClineMessage[]>
	firstApiReqStarted: Map<string, boolean>
	log: (sessionId: string, line: string) => void
	postChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	postState: () => void
	postStateEvent: (sessionId: string, payload: StateEventPayload) => void
	onPaymentRequiredPrompt?: (payload: KilocodePayload) => void
}

export class KilocodeEventProcessor {
	private readonly processHandler: RuntimeProcessHandler
	private readonly registry: AgentRegistry
	private readonly sessionMessages: Map<string, ClineMessage[]>
	private readonly firstApiReqStarted: Map<string, boolean>
	private readonly log: (sessionId: string, line: string) => void
	private readonly postChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	private readonly postState: () => void
	private readonly postStateEvent: (sessionId: string, payload: StateEventPayload) => void
	private readonly onPaymentRequiredPrompt?: (payload: KilocodePayload) => void

	constructor(deps: Dependencies) {
		this.processHandler = deps.processHandler
		this.registry = deps.registry
		this.sessionMessages = deps.sessionMessages
		this.firstApiReqStarted = deps.firstApiReqStarted
		this.log = deps.log
		this.postChatMessages = deps.postChatMessages
		this.postState = deps.postState
		this.postStateEvent = deps.postStateEvent
		this.onPaymentRequiredPrompt = deps.onPaymentRequiredPrompt
	}

	public handle(sessionId: string, event: KilocodeStreamEvent): void {
		const payload = event.payload
		const messageType = payload.type === "ask" ? "ask" : payload.type === "say" ? "say" : null
		const isCommandOutput = payload.ask === "command_output" || payload.say === "command_output"

		// Log incoming event
		const eventDesc = `${messageType}:${payload.say || payload.ask || "?"}`
		const contentPreview = (payload.content as string)?.slice(0, 30) || (payload.text as string)?.slice(0, 30) || ""
		this.log(sessionId, `[Event←] ${eventDesc} ${contentPreview ? `"${contentPreview}..."` : "(no content)"}`)

		if (!messageType) {
			// Unknown payloads (e.g., session_created) are logged but not shown as chat
			const evtName = (payload as { event?: string }).event || payload.type || "event"
			this.log(sessionId, `[Event] Skipping unknown: ${evtName}`)
			return
		}

		// Track first api_req_started to identify user echo
		if (payload.say === "api_req_started") {
			const wasSet = this.firstApiReqStarted.get(sessionId)
			this.firstApiReqStarted.set(sessionId, true)
			// Only notify webview for NEW requests, not usage updates
			// Usage updates have tokensIn/tokensOut in metadata
			const meta = payload.metadata as Record<string, unknown> | undefined
			const isUsageUpdate = meta && (meta.tokensIn !== undefined || meta.tokensOut !== undefined)
			if (!isUsageUpdate) {
				this.log(sessionId, `[Event] api_req_started → posting stateEvent (wasSet=${wasSet})`)
				this.postStateEvent(sessionId, { eventType: "api_req_started" })
			}
			// We don't render api_req_started/finished as chat rows
			return
		}
		if (payload.say === "api_req_finished") {
			this.log(sessionId, `[Event] Skipping api_req_finished`)
			return
		}
		// Skip echo of initial user prompt (say:text before first api_req_started)
		if (payload.say === "text" && !this.firstApiReqStarted.get(sessionId)) {
			this.log(
				sessionId,
				`[Event] SKIPPING user echo (firstApiReqStarted=false): "${(payload.content as string)?.slice(0, 50)}"`,
			)
			return
		}

		// Skip empty partial messages
		const rawContent = payload.content || payload.text
		if (payload.partial && !rawContent && !isCommandOutput) {
			return
		}

		// Handle ask:completion_result early - it has no text but needs to trigger state event
		if (payload.type === "ask" && payload.ask === "completion_result") {
			this.postStateEvent(sessionId, { eventType: "ask_completion_result" })
			return
		}

		// Handle resume asks early - they're state signals, not content to display
		// The state machine transitions to paused/waiting_input, no chat message needed
		if (payload.type === "ask" && (payload.ask === "resume_task" || payload.ask === "resume_completed_task")) {
			this.postStateEvent(sessionId, { eventType: "ask_resume_task" })
			return
		}

		const timestamp = (payload.timestamp as number | undefined) ?? (payload as { ts?: number }).ts ?? Date.now()
		const checkpoint = (payload as { checkpoint?: Record<string, unknown> }).checkpoint
		const text = this.deriveMessageText(payload, checkpoint)
		const metadata = payload.metadata as Record<string, unknown> | undefined

		const message: ClineMessage = {
			ts: timestamp,
			type: messageType,
			say: payload.say as ClineMessage["say"],
			ask: payload.ask as ClineMessage["ask"],
			text,
			partial: payload.partial ?? false,
			isAnswered: payload.isAnswered as boolean | undefined,
			metadata,
			checkpoint,
		}

		// If we have a checkpoint, render as a distinct entry by forcing say=checkpoint_saved and clearing ask
		if (checkpoint && payload.say === "checkpoint_saved") {
			message.say = "checkpoint_saved"
			message.ask = undefined
		}

		// If content/text missing for ask messages, synthesize from ask subtype
		if (!message.text && message.type === "ask" && message.ask) {
			if (message.ask === "tool") {
				message.text = this.formatToolAskText(payload.metadata)
			} else if (message.ask !== "command_output") {
				message.text = message.ask
			}
		}

		// Drop empty messages (except checkpoints)
		const isCommandOutputMessage = message.ask === "command_output" || message.say === "command_output"
		if (!message.text && message.say !== "checkpoint_saved" && !isCommandOutputMessage) {
			return
		}

		// Update or append message (dedupe by ts + type + say/ask; final replaces partial)
		const messages = this.sessionMessages.get(sessionId) || []

		// Special handling for paid-model prompts: show once, mark session error, stop process to avoid spam
		if (message.ask === "payment_required_prompt") {
			const alreadyShown = messages.some((m) => m.ask === "payment_required_prompt")
			if (alreadyShown) {
				return
			}

			this.onPaymentRequiredPrompt?.(payload)
			this.processHandler.stopProcess(sessionId)
			const errorText = message.text || "Paid model requires credits or billing setup."
			this.registry.updateSessionStatus(sessionId, "error", undefined, errorText)
			this.postState()
		}

		const key = this.getMessageKey(message)
		const existingIdx = messages.findIndex((m) => this.getMessageKey(m) === key)
		if (existingIdx >= 0) {
			const existing = messages[existingIdx]
			if (!message.partial || existing.partial) {
				messages[existingIdx] = message
			}
		} else {
			messages.push(message)
		}
		this.sessionMessages.set(sessionId, messages)

		// Send state events to webview for state machine transitions
		this.sendStateEventForMessage(sessionId, payload)

		// Send to webview
		this.postChatMessages(sessionId, messages)

		// Log summary
		const summary = `${messageType}:${payload.say || payload.ask || ""}`
		this.log(sessionId, summary)
	}

	/**
	 * Send state machine events based on the payload type.
	 * This keeps the webview state machine in sync with CLI events.
	 */
	private sendStateEventForMessage(sessionId: string, payload: KilocodePayload): void {
		const partial = payload.partial ?? false

		// Completion result (say:completion_result) → completed state
		if (payload.say === "completion_result" && !partial) {
			this.postStateEvent(sessionId, { eventType: "ask_completion_result" })
			return
		}

		// Ask events that affect state machine
		if (payload.type === "ask" && payload.ask) {
			switch (payload.ask) {
				// Input-required asks → waiting_input
				case "followup":
					this.postStateEvent(sessionId, { eventType: "ask_followup", partial })
					break

				// Approval-required asks → waiting_approval
				case "tool":
				case "command":
				case "browser_action_launch":
				case "use_mcp_server":
					this.postStateEvent(sessionId, { eventType: `ask_${payload.ask}`, partial })
					break

				// Paused state
				case "resume_task":
				case "resume_completed_task":
					this.postStateEvent(sessionId, { eventType: "ask_resume_task" })
					break

				// Error states
				case "api_req_failed":
				case "mistake_limit_reached":
				case "invalid_model":
				case "payment_required_prompt":
					this.postStateEvent(sessionId, { eventType: `ask_${payload.ask}` })
					break
			}
		}
	}

	private deriveMessageText(payload: KilocodePayload, checkpoint?: Record<string, unknown>): string {
		// Regular content/text first
		if (payload.content) return payload.content as string
		if (payload.text) return payload.text as string

		// Checkpoints: do not render hash as chat text; let UI handle via checkpoint
		if (payload.say === "checkpoint_saved") {
			return ""
		}

		// Tool asks
		if (payload.ask === "tool") {
			return this.formatToolAskText(payload.metadata) || ""
		}

		// command_output messages from the CLI often encode output in `metadata`
		// (because the CLI JSON renderer parses `text` JSON into `metadata`).
		if ((payload.ask === "command_output" || payload.say === "command_output") && payload.metadata) {
			const output = (payload.metadata as { output?: unknown }).output
			if (typeof output === "string") {
				return output
			}
			if (output != null) {
				return String(output)
			}
			return ""
		}

		// Fallback empty
		return ""
	}

	private formatToolAskText(metadata?: Record<string, unknown>): string | undefined {
		if (!metadata) return undefined
		const tool = (metadata as { tool?: string }).tool
		const query = (metadata as { query?: string }).query
		const args = (metadata as { args?: unknown }).args
		if (tool) {
			if (query) return `Tool: ${tool} (${String(query)})`
			if (args) return `Tool: ${tool} (${JSON.stringify(args)})`
			return `Tool: ${tool}`
		}
		return undefined
	}

	private getMessageKey(message: ClineMessage): string {
		// For command_output, use executionId from metadata for deduplication
		// This ensures we don't show duplicate outputs when isAnswered changes from false to true
		if (message.ask === "command_output" || message.say === "command_output") {
			const executionId = (message.metadata as { executionId?: string } | undefined)?.executionId
			if (executionId) {
				return `command_output-${executionId}`
			}
		}
		return `${message.ts}-${message.type}-${message.say ?? ""}-${message.ask ?? ""}`
	}
}

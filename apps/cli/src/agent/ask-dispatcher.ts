/**
 * AskDispatcher - Routes ask messages to appropriate handlers
 *
 * This dispatcher is responsible for:
 * - Categorizing ask types using type guards from client module
 * - Routing to the appropriate handler based on ask category
 * - Coordinating between OutputManager and PromptManager
 * - Tracking which asks have been handled (to avoid duplicates)
 *
 * Design notes:
 * - Uses isIdleAsk, isInteractiveAsk, isResumableAsk, isNonBlockingAsk type guards
 * - Single responsibility: Ask routing and handling only
 * - Delegates output to OutputManager, input to PromptManager
 * - Sends responses back through a provided callback
 */

import {
	type WebviewMessage,
	type ClineMessage,
	type ClineAsk,
	type ClineAskResponse,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
	isNonBlockingAsk,
} from "@roo-code/types"
import { debugLog } from "@roo-code/core/cli"

import { FOLLOWUP_TIMEOUT_SECONDS } from "@/types/index.js"

import type { OutputManager } from "./output-manager.js"
import type { PromptManager } from "./prompt-manager.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for AskDispatcher.
 */
export interface AskDispatcherOptions {
	/**
	 * OutputManager for displaying ask-related output.
	 */
	outputManager: OutputManager

	/**
	 * PromptManager for collecting user input.
	 */
	promptManager: PromptManager

	/**
	 * Callback to send responses to the extension.
	 */
	sendMessage: (message: WebviewMessage) => void

	/**
	 * Whether running in non-interactive mode (auto-approve).
	 */
	nonInteractive?: boolean

	/**
	 * Whether to disable ask handling (for TUI mode).
	 * In TUI mode, the TUI handles asks directly.
	 */
	disabled?: boolean
}

/**
 * Result of handling an ask.
 */
export interface AskHandleResult {
	/** Whether the ask was handled */
	handled: boolean
	/** The response sent (if any) */
	response?: ClineAskResponse
	/** Any error that occurred */
	error?: Error
}

// =============================================================================
// AskDispatcher Class
// =============================================================================

export class AskDispatcher {
	private outputManager: OutputManager
	private promptManager: PromptManager
	private sendMessage: (message: WebviewMessage) => void
	private nonInteractive: boolean
	private disabled: boolean

	/**
	 * Track which asks have been handled to avoid duplicates.
	 * Key: message ts
	 */
	private handledAsks = new Set<number>()

	constructor(options: AskDispatcherOptions) {
		this.outputManager = options.outputManager
		this.promptManager = options.promptManager
		this.sendMessage = options.sendMessage
		this.nonInteractive = options.nonInteractive ?? false
		this.disabled = options.disabled ?? false
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	/**
	 * Handle an ask message.
	 * Routes to the appropriate handler based on ask type.
	 *
	 * @param message - The ClineMessage with type="ask"
	 * @returns Promise<AskHandleResult>
	 */
	async handleAsk(message: ClineMessage): Promise<AskHandleResult> {
		// Disabled in TUI mode - TUI handles asks directly
		if (this.disabled) {
			return { handled: false }
		}

		const ts = message.ts
		const ask = message.ask
		const text = message.text || ""

		// Check if already handled
		if (this.handledAsks.has(ts)) {
			return { handled: true }
		}

		// Must be an ask message
		if (message.type !== "ask" || !ask) {
			return { handled: false }
		}

		// Skip partial messages (wait for complete)
		if (message.partial) {
			return { handled: false }
		}

		// Mark as being handled
		this.handledAsks.add(ts)

		try {
			// Route based on ask category
			if (isNonBlockingAsk(ask)) {
				return await this.handleNonBlockingAsk(ts, ask, text)
			}

			if (isIdleAsk(ask)) {
				return await this.handleIdleAsk(ts, ask, text)
			}

			if (isResumableAsk(ask)) {
				return await this.handleResumableAsk(ts, ask, text)
			}

			if (isInteractiveAsk(ask)) {
				return await this.handleInteractiveAsk(ts, ask, text)
			}

			// Unknown ask type - log and handle generically
			debugLog("[AskDispatcher] Unknown ask type", { ask, ts })
			return await this.handleUnknownAsk(ts, ask, text)
		} catch (error) {
			// Re-allow handling on error
			this.handledAsks.delete(ts)
			return {
				handled: false,
				error: error instanceof Error ? error : new Error(String(error)),
			}
		}
	}

	/**
	 * Check if an ask has been handled.
	 */
	isHandled(ts: number): boolean {
		return this.handledAsks.has(ts)
	}

	/**
	 * Clear handled asks (call when starting new task).
	 */
	clear(): void {
		this.handledAsks.clear()
	}

	// ===========================================================================
	// Category Handlers
	// ===========================================================================

	/**
	 * Handle non-blocking asks (command_output).
	 * These don't actually block the agent - just need acknowledgment.
	 */
	private async handleNonBlockingAsk(_ts: number, _ask: ClineAsk, _text: string): Promise<AskHandleResult> {
		// command_output - output is handled by OutputManager
		// Just send approval to continue
		this.sendApprovalResponse(true)
		return { handled: true, response: "yesButtonClicked" }
	}

	/**
	 * Handle idle asks (completion_result, api_req_failed, etc.).
	 * These indicate the task has stopped.
	 */
	private async handleIdleAsk(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		switch (ask) {
			case "completion_result":
				// Task complete - nothing to do here, TaskCompleted event handles it
				return { handled: true }

			case "api_req_failed":
				return await this.handleApiFailedRetry(ts, text)

			case "mistake_limit_reached":
				return await this.handleMistakeLimitReached(ts, text)

			case "resume_completed_task":
				return await this.handleResumeTask(ts, ask, text)

			case "auto_approval_max_req_reached":
				return await this.handleAutoApprovalMaxReached(ts, text)

			default:
				return { handled: false }
		}
	}

	/**
	 * Handle resumable asks (resume_task).
	 */
	private async handleResumableAsk(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		return await this.handleResumeTask(ts, ask, text)
	}

	/**
	 * Handle interactive asks (followup, command, tool, browser_action_launch, use_mcp_server).
	 * These require user approval or input.
	 */
	private async handleInteractiveAsk(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		switch (ask) {
			case "followup":
				return await this.handleFollowupQuestion(ts, text)

			case "command":
				return await this.handleCommandApproval(ts, text)

			case "tool":
				return await this.handleToolApproval(ts, text)

			case "browser_action_launch":
				return await this.handleBrowserApproval(ts, text)

			case "use_mcp_server":
				return await this.handleMcpApproval(ts, text)

			default:
				return { handled: false }
		}
	}

	/**
	 * Handle unknown ask types.
	 */
	private async handleUnknownAsk(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		if (this.nonInteractive) {
			if (text) {
				this.outputManager.output(`\n[${ask}]`, text)
			}
			return { handled: true }
		}

		return await this.handleGenericApproval(ts, ask, text)
	}

	// ===========================================================================
	// Specific Ask Handlers
	// ===========================================================================

	/**
	 * Handle followup questions - prompt for text input with suggestions.
	 */
	private async handleFollowupQuestion(ts: number, text: string): Promise<AskHandleResult> {
		let question = text
		let suggestions: Array<{ answer: string; mode?: string | null }> = []

		try {
			const data = JSON.parse(text)
			question = data.question || text
			suggestions = Array.isArray(data.suggest) ? data.suggest : []
		} catch {
			// Use raw text if not JSON
		}

		this.outputManager.output("\n[question]", question)

		if (suggestions.length > 0) {
			this.outputManager.output("\nSuggested answers:")
			suggestions.forEach((suggestion, index) => {
				const suggestionText = suggestion.answer || String(suggestion)
				const modeHint = suggestion.mode ? ` (mode: ${suggestion.mode})` : ""
				this.outputManager.output(`  ${index + 1}. ${suggestionText}${modeHint}`)
			})
			this.outputManager.output("")
		}

		const firstSuggestion = suggestions.length > 0 ? suggestions[0] : null
		const defaultAnswer = firstSuggestion?.answer ?? ""

		if (this.nonInteractive) {
			// Use timeout prompt in non-interactive mode
			const timeoutMs = FOLLOWUP_TIMEOUT_SECONDS * 1000
			const result = await this.promptManager.promptWithTimeout(
				suggestions.length > 0
					? `Enter number (1-${suggestions.length}) or type your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `
					: `Your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `,
				timeoutMs,
				defaultAnswer,
			)

			let responseText = result.value.trim()
			responseText = this.resolveNumberedSuggestion(responseText, suggestions)

			if (result.timedOut || result.cancelled) {
				this.outputManager.output(`[Using default: ${defaultAnswer || "(empty)"}]`)
			}

			this.sendFollowupResponse(responseText)
			return { handled: true, response: "messageResponse" }
		}

		// Interactive mode
		try {
			const answer = await this.promptManager.promptForInput(
				suggestions.length > 0
					? `Enter number (1-${suggestions.length}) or type your answer: `
					: "Your answer: ",
			)

			let responseText = answer.trim()
			responseText = this.resolveNumberedSuggestion(responseText, suggestions)

			this.sendFollowupResponse(responseText)
			return { handled: true, response: "messageResponse" }
		} catch {
			this.outputManager.output(`[Using default: ${defaultAnswer || "(empty)"}]`)
			this.sendFollowupResponse(defaultAnswer)
			return { handled: true, response: "messageResponse" }
		}
	}

	/**
	 * Handle command execution approval.
	 */
	private async handleCommandApproval(ts: number, text: string): Promise<AskHandleResult> {
		this.outputManager.output("\n[command request]")
		this.outputManager.output(`  Command: ${text || "(no command specified)"}`)
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-approved by extension settings
			return { handled: true }
		}

		try {
			const approved = await this.promptManager.promptForYesNo("Execute this command? (y/n): ")
			this.sendApprovalResponse(approved)
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle tool execution approval.
	 */
	private async handleToolApproval(ts: number, text: string): Promise<AskHandleResult> {
		let toolName = "unknown"
		let toolInfo: Record<string, unknown> = {}

		try {
			toolInfo = JSON.parse(text) as Record<string, unknown>
			toolName = (toolInfo.tool as string) || "unknown"
		} catch {
			// Use raw text if not JSON
		}

		const isProtected = toolInfo.isProtected === true

		if (isProtected) {
			this.outputManager.output(`\n[Tool Request] ${toolName} [PROTECTED CONFIGURATION FILE]`)
			this.outputManager.output(`⚠️  WARNING: This tool wants to modify a protected configuration file.`)
			this.outputManager.output(
				`    Protected files include .rooignore, .roo/*, and other sensitive config files.`,
			)
		} else {
			this.outputManager.output(`\n[Tool Request] ${toolName}`)
		}

		// Display tool details
		for (const [key, value] of Object.entries(toolInfo)) {
			if (key === "tool" || key === "isProtected") continue

			let displayValue: string
			if (typeof value === "string") {
				displayValue = value.length > 200 ? value.substring(0, 200) + "..." : value
			} else if (typeof value === "object" && value !== null) {
				const json = JSON.stringify(value)
				displayValue = json.length > 200 ? json.substring(0, 200) + "..." : json
			} else {
				displayValue = String(value)
			}

			this.outputManager.output(`  ${key}: ${displayValue}`)
		}

		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-approved by extension settings (unless protected)
			return { handled: true }
		}

		try {
			const approved = await this.promptManager.promptForYesNo("Approve this action? (y/n): ")
			this.sendApprovalResponse(approved)
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle browser action approval.
	 */
	private async handleBrowserApproval(ts: number, text: string): Promise<AskHandleResult> {
		this.outputManager.output("\n[browser action request]")
		if (text) {
			this.outputManager.output(`  Action: ${text}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-approved by extension settings
			return { handled: true }
		}

		try {
			const approved = await this.promptManager.promptForYesNo("Allow browser action? (y/n): ")
			this.sendApprovalResponse(approved)
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle MCP server access approval.
	 */
	private async handleMcpApproval(ts: number, text: string): Promise<AskHandleResult> {
		let serverName = "unknown"
		let toolName = ""
		let resourceUri = ""

		try {
			const mcpInfo = JSON.parse(text)
			serverName = mcpInfo.server_name || "unknown"

			if (mcpInfo.type === "use_mcp_tool") {
				toolName = mcpInfo.tool_name || ""
			} else if (mcpInfo.type === "access_mcp_resource") {
				resourceUri = mcpInfo.uri || ""
			}
		} catch {
			// Use raw text if not JSON
		}

		this.outputManager.output("\n[mcp request]")
		this.outputManager.output(`  Server: ${serverName}`)
		if (toolName) {
			this.outputManager.output(`  Tool: ${toolName}`)
		}
		if (resourceUri) {
			this.outputManager.output(`  Resource: ${resourceUri}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-approved by extension settings
			return { handled: true }
		}

		try {
			const approved = await this.promptManager.promptForYesNo("Allow MCP access? (y/n): ")
			this.sendApprovalResponse(approved)
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle API request failed - retry prompt.
	 */
	private async handleApiFailedRetry(ts: number, text: string): Promise<AskHandleResult> {
		this.outputManager.output("\n[api request failed]")
		this.outputManager.output(`  Error: ${text || "Unknown error"}`)
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			this.outputManager.output("\n[retrying api request]")
			// Auto-retry in non-interactive mode
			return { handled: true }
		}

		try {
			const retry = await this.promptManager.promptForYesNo("Retry the request? (y/n): ")
			this.sendApprovalResponse(retry)
			return { handled: true, response: retry ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle mistake limit reached.
	 */
	private async handleMistakeLimitReached(ts: number, text: string): Promise<AskHandleResult> {
		this.outputManager.output("\n[mistake limit reached]")
		if (text) {
			this.outputManager.output(`  Details: ${text}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-proceed in non-interactive mode
			this.sendApprovalResponse(true)
			return { handled: true, response: "yesButtonClicked" }
		}

		try {
			const proceed = await this.promptManager.promptForYesNo("Continue anyway? (y/n): ")
			this.sendApprovalResponse(proceed)
			return { handled: true, response: proceed ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle auto-approval max reached.
	 */
	private async handleAutoApprovalMaxReached(ts: number, text: string): Promise<AskHandleResult> {
		this.outputManager.output("\n[auto-approval limit reached]")
		if (text) {
			this.outputManager.output(`  Details: ${text}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			// Auto-proceed in non-interactive mode
			this.sendApprovalResponse(true)
			return { handled: true, response: "yesButtonClicked" }
		}

		try {
			const proceed = await this.promptManager.promptForYesNo("Continue with manual approval? (y/n): ")
			this.sendApprovalResponse(proceed)
			return { handled: true, response: proceed ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle task resume prompt.
	 */
	private async handleResumeTask(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		const isCompleted = ask === "resume_completed_task"
		this.outputManager.output(`\n[Resume ${isCompleted ? "Completed " : ""}Task]`)
		if (text) {
			this.outputManager.output(`  ${text}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		if (this.nonInteractive) {
			this.outputManager.output("\n[continuing task]")
			// Auto-resume in non-interactive mode
			this.sendApprovalResponse(true)
			return { handled: true, response: "yesButtonClicked" }
		}

		try {
			const resume = await this.promptManager.promptForYesNo("Continue with this task? (y/n): ")
			this.sendApprovalResponse(resume)
			return { handled: true, response: resume ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	/**
	 * Handle generic approval prompts for unknown ask types.
	 */
	private async handleGenericApproval(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		this.outputManager.output(`\n[${ask}]`)
		if (text) {
			this.outputManager.output(`  ${text}`)
		}
		this.outputManager.markDisplayed(ts, text || "", false)

		try {
			const approved = await this.promptManager.promptForYesNo("Approve? (y/n): ")
			this.sendApprovalResponse(approved)
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
			return { handled: true, response: "noButtonClicked" }
		}
	}

	// ===========================================================================
	// Response Helpers
	// ===========================================================================

	/**
	 * Send a followup response (text answer) to the extension.
	 */
	private sendFollowupResponse(text: string): void {
		this.sendMessage({ type: "askResponse", askResponse: "messageResponse", text })
	}

	/**
	 * Send an approval response (yes/no) to the extension.
	 */
	private sendApprovalResponse(approved: boolean): void {
		this.sendMessage({
			type: "askResponse",
			askResponse: approved ? "yesButtonClicked" : "noButtonClicked",
		})
	}

	/**
	 * Resolve a numbered suggestion selection.
	 */
	private resolveNumberedSuggestion(
		input: string,
		suggestions: Array<{ answer: string; mode?: string | null }>,
	): string {
		const num = parseInt(input, 10)
		if (!isNaN(num) && num >= 1 && num <= suggestions.length) {
			const selectedSuggestion = suggestions[num - 1]
			if (selectedSuggestion) {
				const selected = selectedSuggestion.answer || String(selectedSuggestion)
				this.outputManager.output(`Selected: ${selected}`)
				return selected
			}
		}
		return input
	}
}

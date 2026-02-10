/**
 * Agent Loop State Detection
 *
 * This module provides the core logic for detecting the current state of the
 * Roo Code agent loop. The state is determined by analyzing the clineMessages
 * array, specifically the last message's type and properties.
 *
 * Key insight: The agent loop stops whenever a message with `type: "ask"` arrives,
 * and the specific `ask` value determines what kind of response the agent is waiting for.
 */

import { ClineMessage, ClineAsk, isIdleAsk, isResumableAsk, isInteractiveAsk, isNonBlockingAsk } from "@roo-code/types"

// =============================================================================
// Agent Loop State Enum
// =============================================================================

/**
 * The possible states of the agent loop.
 *
 * State Machine:
 * ```
 *                    ┌─────────────────┐
 *                    │   NO_TASK       │ (initial state)
 *                    └────────┬────────┘
 *                             │ newTask
 *                             ▼
 *              ┌─────────────────────────────┐
 *         ┌───▶│         RUNNING             │◀───┐
 *         │    └──────────┬──────────────────┘    │
 *         │               │                       │
 *         │    ┌──────────┼──────────────┐        │
 *         │    │          │              │        │
 *         │    ▼          ▼              ▼        │
 *         │ ┌──────┐  ┌─────────┐  ┌──────────┐   │
 *         │ │STREAM│  │INTERACT │  │  IDLE    │   │
 *         │ │ ING  │  │  IVE    │  │          │   │
 *         │ └──┬───┘  └────┬────┘  └────┬─────┘   │
 *         │    │           │            │         │
 *         │    │ done      │ approved   │ newTask │
 *         └────┴───────────┴────────────┘         │
 *                                                 │
 *         ┌──────────────┐                        │
 *         │  RESUMABLE   │────────────────────────┘
 *         └──────────────┘  resumed
 * ```
 */
export enum AgentLoopState {
	/**
	 * No active task. This is the initial state before any task is started,
	 * or after a task has been cleared.
	 */
	NO_TASK = "no_task",

	/**
	 * Agent is actively processing. This means:
	 * - The last message is a "say" type (informational), OR
	 * - The last message is a non-blocking ask (command_output)
	 *
	 * In this state, the agent may be:
	 * - Executing tools
	 * - Thinking/reasoning
	 * - Processing between API calls
	 */
	RUNNING = "running",

	/**
	 * Agent is streaming a response. This is detected when:
	 * - `partial === true` on the last message, OR
	 * - The last `api_req_started` message has no `cost` in its text field
	 *
	 * Do NOT consider the agent "waiting" while streaming.
	 */
	STREAMING = "streaming",

	/**
	 * Agent is waiting for user approval or input. This includes:
	 * - Tool approvals (file operations)
	 * - Command execution permission
	 * - Browser action permission
	 * - MCP server permission
	 * - Follow-up questions
	 *
	 * User must approve, reject, or provide input to continue.
	 */
	WAITING_FOR_INPUT = "waiting_for_input",

	/**
	 * Task is in an idle/terminal state. This includes:
	 * - Task completed successfully (completion_result)
	 * - API request failed (api_req_failed)
	 * - Too many errors (mistake_limit_reached)
	 * - Auto-approval limit reached
	 * - Completed task waiting to be resumed
	 *
	 * User can start a new task or retry.
	 */
	IDLE = "idle",

	/**
	 * Task is paused and can be resumed. This happens when:
	 * - User navigated away from a task
	 * - Extension was restarted mid-task
	 *
	 * User can resume or abandon the task.
	 */
	RESUMABLE = "resumable",
}

// =============================================================================
// Detailed State Info
// =============================================================================

/**
 * What action the user should/can take in the current state.
 */
export type RequiredAction =
	| "none" // No action needed (running/streaming)
	| "approve" // Can approve/reject (tool, command, browser, mcp)
	| "answer" // Need to answer a question (followup)
	| "retry_or_new_task" // Can retry or start new task (api_req_failed)
	| "proceed_or_new_task" // Can proceed or start new task (mistake_limit)
	| "start_task" // Should start a new task (completion_result)
	| "resume_or_abandon" // Can resume or abandon (resume_task)
	| "start_new_task" // Should start new task (resume_completed_task, no_task)
	| "continue_or_abort" // Can continue or abort (command_output)

/**
 * Detailed information about the current agent state.
 * Provides everything needed to render UI or make decisions.
 */
export interface AgentStateInfo {
	/** The high-level state of the agent loop */
	state: AgentLoopState

	/** Whether the agent is waiting for user input/action */
	isWaitingForInput: boolean

	/** Whether the agent loop is actively processing */
	isRunning: boolean

	/** Whether content is being streamed */
	isStreaming: boolean

	/** The specific ask type if waiting on an ask, undefined otherwise */
	currentAsk?: ClineAsk

	/** What action the user should/can take */
	requiredAction: RequiredAction

	/** The timestamp of the last message, useful for tracking */
	lastMessageTs?: number

	/** The full last message for advanced usage */
	lastMessage?: ClineMessage

	/** Human-readable description of the current state */
	description: string
}

// =============================================================================
// State Detection Functions
// =============================================================================

/**
 * Structure of the text field in api_req_started messages.
 * Used to determine if the API request has completed (cost is defined).
 */
export interface ApiReqStartedText {
	cost?: number // Undefined while streaming, defined when complete.
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

/**
 * Check if an API request is still in progress (streaming).
 *
 * API requests are considered in-progress when:
 * - An api_req_started message exists
 * - Its text field, when parsed, has `cost: undefined`
 *
 * Once the request completes, the cost field will be populated.
 */
function isApiRequestInProgress(messages: ClineMessage[]): boolean {
	// Find the last api_req_started message.
	// Using reverse iteration for efficiency (most recent first).
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]

		if (!message) {
			continue
		}

		if (message.say === "api_req_started") {
			if (!message.text) {
				// No text yet means still in progress.
				return true
			}

			try {
				const data: ApiReqStartedText = JSON.parse(message.text)
				// cost is undefined while streaming, defined when complete.
				return data.cost === undefined
			} catch {
				// Parse error - assume not in progress.
				return false
			}
		}
	}
	return false
}

/**
 * Determine the required action based on the current ask type.
 */
function getRequiredAction(ask: ClineAsk): RequiredAction {
	switch (ask) {
		case "followup":
			return "answer"
		case "command":
		case "tool":
		case "browser_action_launch":
		case "use_mcp_server":
			return "approve"
		case "command_output":
			return "continue_or_abort"
		case "api_req_failed":
			return "retry_or_new_task"
		case "mistake_limit_reached":
			return "proceed_or_new_task"
		case "completion_result":
			return "start_task"
		case "resume_task":
			return "resume_or_abandon"
		case "resume_completed_task":
		case "auto_approval_max_req_reached":
			return "start_new_task"
		default:
			return "none"
	}
}

/**
 * Get a human-readable description for the current state.
 */
function getStateDescription(state: AgentLoopState, ask?: ClineAsk): string {
	switch (state) {
		case AgentLoopState.NO_TASK:
			return "No active task. Ready to start a new task."

		case AgentLoopState.RUNNING:
			return "Agent is actively processing."

		case AgentLoopState.STREAMING:
			return "Agent is streaming a response."

		case AgentLoopState.WAITING_FOR_INPUT:
			switch (ask) {
				case "followup":
					return "Agent is asking a follow-up question. Please provide an answer."
				case "command":
					return "Agent wants to execute a command. Approve or reject."
				case "tool":
					return "Agent wants to perform a file operation. Approve or reject."
				case "browser_action_launch":
					return "Agent wants to use the browser. Approve or reject."
				case "use_mcp_server":
					return "Agent wants to use an MCP server. Approve or reject."
				default:
					return "Agent is waiting for user input."
			}

		case AgentLoopState.IDLE:
			switch (ask) {
				case "completion_result":
					return "Task completed successfully. You can provide feedback or start a new task."
				case "api_req_failed":
					return "API request failed. You can retry or start a new task."
				case "mistake_limit_reached":
					return "Too many errors encountered. You can proceed anyway or start a new task."
				case "auto_approval_max_req_reached":
					return "Auto-approval limit reached. Manual approval required."
				case "resume_completed_task":
					return "Previously completed task. Start a new task to continue."
				default:
					return "Task is idle."
			}

		case AgentLoopState.RESUMABLE:
			return "Task is paused. You can resume or start a new task."

		default:
			return "Unknown state."
	}
}

/**
 * Detect the current state of the agent loop from the clineMessages array.
 *
 * This is the main state detection function. It analyzes the messages array
 * and returns detailed information about the current agent state.
 *
 * @param messages - The clineMessages array from extension state
 * @returns Detailed state information
 */
export function detectAgentState(messages: ClineMessage[]): AgentStateInfo {
	// No messages means no task
	if (!messages || messages.length === 0) {
		return {
			state: AgentLoopState.NO_TASK,
			isWaitingForInput: false,
			isRunning: false,
			isStreaming: false,
			requiredAction: "start_new_task",
			description: getStateDescription(AgentLoopState.NO_TASK),
		}
	}

	const lastMessage = messages[messages.length - 1]

	// Guard against undefined (should never happen after length check, but TypeScript requires it)
	if (!lastMessage) {
		return {
			state: AgentLoopState.NO_TASK,
			isWaitingForInput: false,
			isRunning: false,
			isStreaming: false,
			requiredAction: "start_new_task",
			description: getStateDescription(AgentLoopState.NO_TASK),
		}
	}

	// Check if the message is still streaming (partial)
	// This is the PRIMARY indicator of streaming
	if (lastMessage.partial === true) {
		return {
			state: AgentLoopState.STREAMING,
			isWaitingForInput: false,
			isRunning: true,
			isStreaming: true,
			currentAsk: lastMessage.ask,
			requiredAction: "none",
			lastMessageTs: lastMessage.ts,
			lastMessage,
			description: getStateDescription(AgentLoopState.STREAMING),
		}
	}

	// Handle "ask" type messages
	if (lastMessage.type === "ask" && lastMessage.ask) {
		const ask = lastMessage.ask

		// Non-blocking asks (command_output) - agent is running but can be interrupted
		if (isNonBlockingAsk(ask)) {
			return {
				state: AgentLoopState.RUNNING,
				isWaitingForInput: false,
				isRunning: true,
				isStreaming: false,
				currentAsk: ask,
				requiredAction: "continue_or_abort",
				lastMessageTs: lastMessage.ts,
				lastMessage,
				description: "Command is running. You can continue or abort.",
			}
		}

		// Idle asks - task has stopped
		if (isIdleAsk(ask)) {
			return {
				state: AgentLoopState.IDLE,
				isWaitingForInput: true, // User needs to decide what to do next
				isRunning: false,
				isStreaming: false,
				currentAsk: ask,
				requiredAction: getRequiredAction(ask),
				lastMessageTs: lastMessage.ts,
				lastMessage,
				description: getStateDescription(AgentLoopState.IDLE, ask),
			}
		}

		// Resumable asks - task is paused
		if (isResumableAsk(ask)) {
			return {
				state: AgentLoopState.RESUMABLE,
				isWaitingForInput: true,
				isRunning: false,
				isStreaming: false,
				currentAsk: ask,
				requiredAction: getRequiredAction(ask),
				lastMessageTs: lastMessage.ts,
				lastMessage,
				description: getStateDescription(AgentLoopState.RESUMABLE, ask),
			}
		}

		// Interactive asks - waiting for approval/input
		if (isInteractiveAsk(ask)) {
			return {
				state: AgentLoopState.WAITING_FOR_INPUT,
				isWaitingForInput: true,
				isRunning: false,
				isStreaming: false,
				currentAsk: ask,
				requiredAction: getRequiredAction(ask),
				lastMessageTs: lastMessage.ts,
				lastMessage,
				description: getStateDescription(AgentLoopState.WAITING_FOR_INPUT, ask),
			}
		}
	}

	// For "say" type messages, check if API request is in progress
	if (isApiRequestInProgress(messages)) {
		return {
			state: AgentLoopState.STREAMING,
			isWaitingForInput: false,
			isRunning: true,
			isStreaming: true,
			requiredAction: "none",
			lastMessageTs: lastMessage.ts,
			lastMessage,
			description: getStateDescription(AgentLoopState.STREAMING),
		}
	}

	// Default: agent is running
	return {
		state: AgentLoopState.RUNNING,
		isWaitingForInput: false,
		isRunning: true,
		isStreaming: false,
		requiredAction: "none",
		lastMessageTs: lastMessage.ts,
		lastMessage,
		description: getStateDescription(AgentLoopState.RUNNING),
	}
}

/**
 * Quick check: Is the agent waiting for user input?
 *
 * This is a convenience function for simple use cases where you just need
 * to know if user action is required.
 */
export function isAgentWaitingForInput(messages: ClineMessage[]): boolean {
	return detectAgentState(messages).isWaitingForInput
}

/**
 * Quick check: Is the agent actively running (not waiting)?
 */
export function isAgentRunning(messages: ClineMessage[]): boolean {
	const state = detectAgentState(messages)
	return state.isRunning && !state.isWaitingForInput
}

/**
 * Quick check: Is content currently streaming?
 */
export function isContentStreaming(messages: ClineMessage[]): boolean {
	return detectAgentState(messages).isStreaming
}

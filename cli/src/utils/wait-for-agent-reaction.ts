import wait from "./wait.js"

export interface AgentReactionState {
	isStreaming: boolean
	isApprovalPending: boolean
}

export async function waitForAgentReaction<State extends AgentReactionState>(params: {
	getState: () => State
	pollIntervalMs: number
	reactionStartTimeoutMs: number
	reactionDoneTimeoutMs: number
	waitForStateChange?: () => Promise<void>
}): Promise<void> {
	const { getState, pollIntervalMs, reactionStartTimeoutMs, reactionDoneTimeoutMs, waitForStateChange } = params

	const waitTick = async () => {
		if (waitForStateChange) {
			await Promise.race([waitForStateChange(), wait(pollIntervalMs)])
			return
		}
		await wait(pollIntervalMs)
	}

	const startDeadline = Date.now() + reactionStartTimeoutMs
	while (Date.now() < startDeadline) {
		const state = getState()
		if (state.isApprovalPending) return
		if (state.isStreaming) break
		await waitTick()
	}

	const doneDeadline = Date.now() + reactionDoneTimeoutMs
	while (Date.now() < doneDeadline) {
		const state = getState()
		if (state.isApprovalPending) return
		if (!state.isStreaming) return
		await waitTick()
	}
}


import type { ExtensionChatMessage } from "../../types/messages.js"

const resumeAskTypes = new Set(["resume_task", "resume_completed_task"])

export function isResumeAskMessage(message: ExtensionChatMessage | null): boolean {
	return message?.type === "ask" && resumeAskTypes.has(message.ask ?? "")
}

export function shouldWaitForResumeAsk(
	taskResumedViaSession: boolean,
	hasActiveTask: boolean,
	lastChatMessage: ExtensionChatMessage | null,
): boolean {
	if (!taskResumedViaSession) {
		return false
	}

	if (!hasActiveTask) {
		return true
	}

	return !isResumeAskMessage(lastChatMessage)
}

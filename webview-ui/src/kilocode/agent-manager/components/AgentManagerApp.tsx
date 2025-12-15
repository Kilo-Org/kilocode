import React from "react"
import { Provider, useAtomValue } from "jotai"
import { useAgentManagerMessages } from "../state/hooks"
import { useMessageQueueProcessor } from "../state/hooks/useMessageQueueProcessor"
import { selectedSessionIdAtom } from "../state/atoms/sessions"
import { SessionSidebar } from "./SessionSidebar"
import { SessionDetail } from "./SessionDetail"
import { TooltipProvider } from "../../../components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "../../../components/ui/standard-tooltip"
import "./AgentManagerApp.css"

/**
 * Root component for the Agent Manager webview.
 * Wraps everything in Jotai Provider and sets up message handling.
 */
export function AgentManagerApp() {
	return (
		<Provider>
			<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
				<AgentManagerContent />
			</TooltipProvider>
		</Provider>
	)
}

function AgentManagerContent() {
	// Bridge VS Code IPC messages to Jotai state
	useAgentManagerMessages()

	// Get the currently selected session
	const selectedSessionId = useAtomValue(selectedSessionIdAtom)

	// Process the message queue for the selected session
	// Hook must always be called, but will skip processing if no session selected
	useMessageQueueProcessor(selectedSessionId)

	return (
		<div className="agent-manager-container">
			<SessionSidebar />
			<SessionDetail />
		</div>
	)
}

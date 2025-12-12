import React from "react"
import { Provider } from "jotai"
import { useAgentManagerMessages } from "../state/hooks"
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

	return (
		<div className="agent-manager-container">
			<SessionSidebar />
			<SessionDetail />
		</div>
	)
}

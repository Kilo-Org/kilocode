import React, { useEffect, useState } from "react"

import { type ClineMessage, type ExtensionMessage } from "@roo-code/types"

import { TooltipProvider } from "@src/components/ui/tooltip"
import TranslationProvider from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

import BrowserSessionRow from "../chat/BrowserSessionRow"
import ErrorBoundary from "../ErrorBoundary"

import { BrowserPanelStateProvider, useBrowserPanelState } from "./BrowserPanelStateProvider"

interface BrowserSessionPanelState {
	messages: ClineMessage[]
}

const BrowserSessionPanelContent: React.FC = () => {
	const { browserViewportSize, isBrowserSessionActive } = useBrowserPanelState()
	const [state, setState] = useState<BrowserSessionPanelState>({
		messages: [],
	})
	// Target page index to navigate BrowserSessionRow to
	const [navigateToStepIndex, setNavigateToStepIndex] = useState<number | undefined>(undefined)

	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			switch (message.type) {
				case "browserSessionUpdate":
					if (message.browserSessionMessages) {
						setState((prev) => ({
							...prev,
							messages: message.browserSessionMessages || [],
						}))
					}
					break
				case "browserSessionNavigate":
					if (typeof message.stepIndex === "number" && message.stepIndex >= 0) {
						setNavigateToStepIndex(message.stepIndex)
					}
					break
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return (
		<div className="fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden bg-vscode-editor-background">
			<BrowserSessionRow
				messages={state.messages}
				isLast={true}
				lastModifiedMessage={state.messages.at(-1)}
				isStreaming={false}
				isExpanded={(messageTs: number) => expandedRows[messageTs] ?? false}
				onToggleExpand={(messageTs: number) => {
					setExpandedRows((prev: Record<number, boolean>) => ({
						...prev,
						[messageTs]: !prev[messageTs],
					}))
				}}
				fullScreen={true}
				browserViewportSizeProp={browserViewportSize}
				isBrowserSessionActiveProp={isBrowserSessionActive}
				navigateToPageIndex={navigateToStepIndex}
			/>
		</div>
	)
}

const BrowserSessionPanel: React.FC = () => {
	// Ensure the panel receives initial state and becomes "ready" without needing a second click
	useEffect(() => {
		try {
			vscode.postMessage({ type: "webviewDidLaunch" })
		} catch {
			// Ignore errors during initial launch
		}
	}, [])

	return (
		<ErrorBoundary>
			<ExtensionStateContextProvider>
				<TooltipProvider>
					<TranslationProvider>
						<BrowserPanelStateProvider>
							<BrowserSessionPanelContent />
						</BrowserPanelStateProvider>
					</TranslationProvider>
				</TooltipProvider>
			</ExtensionStateContextProvider>
		</ErrorBoundary>
	)
}

export default BrowserSessionPanel

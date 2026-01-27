import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

import { type ExtensionMessage } from "@roo-code/types"

interface BrowserPanelState {
	browserViewportSize: string
	isBrowserSessionActive: boolean
	language: string
}

const BrowserPanelStateContext = createContext<BrowserPanelState | undefined>(undefined)

export const BrowserPanelStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<BrowserPanelState>({
		browserViewportSize: "900x600",
		isBrowserSessionActive: false,
		language: "en",
	})

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "state":
				if (message.state) {
					setState((prev) => ({
						...prev,
						browserViewportSize: message.state?.browserViewportSize || "900x600",
						isBrowserSessionActive: message.state?.isBrowserSessionActive || false,
						language: message.state?.language || "en",
					}))
				}
				break
			case "browserSessionUpdate":
				if (message.isBrowserSessionActive !== undefined) {
					setState((prev) => ({
						...prev,
						isBrowserSessionActive: message.isBrowserSessionActive || false,
					}))
				}
				break
		}
	}, [])

	useEffect(() => {
		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [handleMessage])

	return <BrowserPanelStateContext.Provider value={state}>{children}</BrowserPanelStateContext.Provider>
}

export const useBrowserPanelState = () => {
	const context = useContext(BrowserPanelStateContext)
	if (context === undefined) {
		throw new Error("useBrowserPanelState must be used within a BrowserPanelStateProvider")
	}
	return context
}

import React from "react"
import { Provider as JotaiProvider } from "jotai"
import { UI } from "./UI.js"
import { KeyboardProvider } from "./providers/KeyboardProvider.js"

import type { createStore } from "jotai"

type JotaiStore = ReturnType<typeof createStore>

export interface AppOptions {
	mode?: string
	workspace?: string
	ci?: boolean
	yolo?: boolean
	json?: boolean
	jsonInteractive?: boolean
	prompt?: string
	timeout?: number
	parallel?: boolean
	worktreeBranch?: string | undefined
	noSplash?: boolean
}

export interface AppProps {
	store: JotaiStore
	options: AppOptions
	onExit: () => void
}

export const App: React.FC<AppProps> = ({ store, options, onExit }) => {
	return (
		<JotaiProvider store={store}>
			<KeyboardProvider>
				<UI options={options} onExit={onExit} />
			</KeyboardProvider>
		</JotaiProvider>
	)
}

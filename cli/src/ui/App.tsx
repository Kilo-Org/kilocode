import React from "react"
import { Provider as JotaiProvider } from "jotai"
import { UI } from "./UI.js"

type JotaiStore = any

export interface AppOptions {
	mode?: string
	workspace?: string
	ci?: boolean
	prompt?: string
	timeout?: number
}

export interface AppProps {
	store: JotaiStore
	options: AppOptions
	onExit: () => void
}

export const App: React.FC<AppProps> = ({ store, options, onExit }) => {
	return (
		<JotaiProvider store={store}>
			<UI options={options} onExit={onExit} />
		</JotaiProvider>
	)
}

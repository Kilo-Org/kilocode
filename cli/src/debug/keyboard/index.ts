import React from "react"
import { render } from "ink"
import { Provider as JotaiProvider, createStore } from "jotai"
import { KeyboardProvider } from "../../ui/providers/KeyboardProvider.js"
import { KeyboardDebugUI } from "./KeyboardDebugUI.js"

export const debugKeyboard = async () => {
	console.log("Starting keyboard debug tool...")
	console.log("Press any key to see keyboard events")
	console.log("Press ESC or Ctrl+C to exit\n")

	// Create a Jotai store for state management
	const store = createStore()

	// Track if we should exit
	let shouldExit = false

	// Exit handler
	const handleExit = () => {
		shouldExit = true
		if (app) {
			app.unmount()
		}
		process.exit(0)
	}

	// Render the Ink app with providers
	const app = render(
		React.createElement(
			JotaiProvider,
			{ store },
			React.createElement(KeyboardProvider, {
				config: { debugKeystrokeLogging: false },
				children: React.createElement(KeyboardDebugUI, { onExit: handleExit }),
			}),
		),
	)

	// Handle process termination
	process.on("SIGINT", handleExit)
	process.on("SIGTERM", handleExit)

	// Wait for exit
	return new Promise<void>((resolve) => {
		const checkExit = setInterval(() => {
			if (shouldExit) {
				clearInterval(checkExit)
				resolve()
			}
		}, 100)
	})
}

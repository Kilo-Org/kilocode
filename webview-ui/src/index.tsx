import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { StagewiseToolbar } from "@stagewise/toolbar-react"

import "./index.css"
import App from "./App"
import "../node_modules/@vscode/codicons/dist/codicon.css"
import "./codicon-custom.css" // kilocode_change

import { getHighlighter } from "./utils/highlighter"

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

// Render the main app
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)

if (process.env.NODE_ENV === "development") {
	const toolbarConfig = {
		plugins: [],
	}

	document.addEventListener("DOMContentLoaded", () => {
		if (document.getElementById("stagewise-toolbar-root")) {
			console.log("Stagewise toolbar already initialized, skipping...")
			return
		}

		const toolbarRoot = document.createElement("div")
		toolbarRoot.id = "stagewise-toolbar-root" // Ensure a unique ID
		document.body.appendChild(toolbarRoot)

		createRoot(toolbarRoot).render(
			<StrictMode>
				<StagewiseToolbar config={toolbarConfig} />
			</StrictMode>,
		)
		console.log("🚀 Stagewise toolbar initialized successfully")
	})
}

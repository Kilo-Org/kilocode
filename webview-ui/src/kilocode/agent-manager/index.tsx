import React from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider } from "react-i18next"
import i18next, { loadTranslations } from "../../i18n/setup"
import ErrorBoundary from "../../components/ErrorBoundary"
import { AgentManagerApp } from "./components/AgentManagerApp"
import "../../../node_modules/@vscode/codicons/dist/codicon.css"
import "../../index.css"

// Initialize i18n translations
loadTranslations()

// Mount the Agent Manager React app
const container = document.getElementById("root")
if (container) {
	const root = createRoot(container)
	root.render(
		<React.StrictMode>
			<I18nextProvider i18n={i18next}>
				<div className="am-app-wrapper">
					<ErrorBoundary>
						<AgentManagerApp />
					</ErrorBoundary>
				</div>
			</I18nextProvider>
		</React.StrictMode>,
	)
}

// Notify extension that webview is ready
import { vscode } from "./utils/vscode"
vscode.postMessage({ type: "agentManager.webviewReady" })

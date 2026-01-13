import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import BrowserSessionPanel from "./components/browser-session/BrowserSessionPanel"
import "../node_modules/@vscode/codicons/dist/codicon.css"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserSessionPanel />
	</StrictMode>,
)

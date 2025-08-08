// Global type definitions for the webview

import type { VSCodeAPIWrapper } from "../utils/vscode"

declare global {
	interface Window {
		vscode?: VSCodeAPIWrapper
	}
}

export {}

/**
 * VS Code webview API wrapper for Agent Manager
 */

interface VSCodeApi {
	postMessage: (message: unknown) => void
	getState: () => unknown
	setState: (state: unknown) => void
}

// Declare the VS Code API acquisition function
declare function acquireVsCodeApi(): VSCodeApi

// Cache the API instance
let vsCodeApi: VSCodeApi | undefined

export function getVSCodeApi(): VSCodeApi {
	if (!vsCodeApi) {
		vsCodeApi = acquireVsCodeApi()
	}
	return vsCodeApi
}

export const vscode = {
	postMessage: (message: unknown) => getVSCodeApi().postMessage(message),
	getState: () => getVSCodeApi().getState(),
	setState: (state: unknown) => getVSCodeApi().setState(state),
}

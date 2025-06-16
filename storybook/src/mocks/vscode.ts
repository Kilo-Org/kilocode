// Mock VS Code API for Storybook
export const vscode = {
	postMessage: (message: any) => {
		console.log("Mock vscode.postMessage:", message)
	},
	getState: () => ({}),
	setState: (state: any) => {
		console.log("Mock vscode.setState:", state)
	},
}

// Mock window.acquireVsCodeApi
if (typeof window !== "undefined") {
	;(window as any).acquireVsCodeApi = () => vscode
}

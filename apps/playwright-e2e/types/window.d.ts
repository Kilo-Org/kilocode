interface VSCodeAPI {
	postMessage(message: unknown): void
	getState(): unknown
	setState(state: unknown): unknown
	getExtension?(extensionId: string): { exports?: unknown } | undefined
}

declare global {
	interface Window {
		vscode: VSCodeAPI
	}
}

export {}

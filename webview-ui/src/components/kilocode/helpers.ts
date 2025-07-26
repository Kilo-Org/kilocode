// Declare the window property to avoid TypeScript errors
declare global {
	interface Window {
		KILOCODE_BASE_URL?: string
	}
}

export function getKiloCodeBackendSignInUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = window.KILOCODE_BASE_URL || "https://kilocode.ai"
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/sign-in-to-editor?source=${source}`
}

export function getKiloCodeBackendSignUpUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = window.KILOCODE_BASE_URL || "https://kilocode.ai"
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/users/sign_up?source=${source}`
}

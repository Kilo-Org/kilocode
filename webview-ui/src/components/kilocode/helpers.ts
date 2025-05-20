export function getKiloCodeBackendAuthUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = "https://kilocode.ai"
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/auth/signin?source=${source}`
}

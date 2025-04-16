export function getKiloCodeBackendAuthUrl(uriScheme: string = "vscode") {
	return `https://kilocode.ai/auth/signin?source=${uriScheme}`
}

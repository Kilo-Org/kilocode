import { vscode } from "@/utils/vscode"

export function getKiloCodeBackendAuthUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = "https://kilocode.ai"
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/auth/signin?source=${source}`
}

export function fetchProfileData() {
	vscode.postMessage({
		type: "fetchProfileDataRequest",
	})
}

export function fetchBalanceData() {
	vscode.postMessage({
		type: "fetchBalanceDataRequest",
	})
}

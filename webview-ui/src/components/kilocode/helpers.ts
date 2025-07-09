import { vscode } from "@/utils/vscode"

// Global state for base URL
let cachedBaseUrl: string = "https://kilocode.ai"
let hasRequestedSetting = false

// Request the setting from VS Code on first use
function ensureBaseUrlRequested() {
	if (!hasRequestedSetting) {
		hasRequestedSetting = true
		vscode.postMessage({ type: "getVSCodeSetting", setting: "kilo-code.baseUrl" })
	}
}

// Listen for VS Code setting responses
window.addEventListener("message", (event) => {
	if (event.data?.type === "vsCodeSetting" && event.data?.setting === "kilo-code.baseUrl") {
		cachedBaseUrl = event.data.value || "https://kilocode.ai"
	}
})

function getBaseUrl(): string {
	ensureBaseUrlRequested()
	return cachedBaseUrl
}

export function getKiloCodeBackendSignInUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = getBaseUrl()
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/users/sign_in?source=${source}`
}

export function getKiloCodeBackendSignUpUrl(uriScheme: string = "vscode", uiKind: string = "Desktop") {
	const baseUrl = getBaseUrl()
	const source = uiKind === "Web" ? "web" : uriScheme
	return `${baseUrl}/users/sign_up?source=${source}`
}

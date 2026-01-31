import { Package } from "@roo/package"

export function getCallbackUrl(provider: string, uriScheme?: string) {
	// JetBrains uses a different URL format for OAuth callbacks
	// Format: jetbrains://idea/ai.kilocode.jetbrains.oauth?provider={provider}
	if (uriScheme === "jetbrains") {
		return encodeURIComponent(`jetbrains://idea/ai.kilocode.jetbrains.oauth?provider=${provider}`)
	}
	// VS Code and other IDEs use the standard format
	// Format: vscode://kilocode/kilo-code/{provider}
	return encodeURIComponent(`${uriScheme || "vscode"}://${Package.publisher}.${Package.name}/${provider}`)
}

// kilocode_change start
export function getGlamaAuthUrl(uriScheme?: string) {
	return `https://glama.ai/oauth/authorize?callback_url=${getCallbackUrl("glama", uriScheme)}`
}
// kilocode_change end

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${getCallbackUrl("openrouter", uriScheme)}`
}

export function getRequestyAuthUrl(uriScheme?: string) {
	return `https://app.requesty.ai/oauth/authorize?callback_url=${getCallbackUrl("requesty", uriScheme)}`
}

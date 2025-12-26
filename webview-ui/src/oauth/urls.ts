import { Package } from "@roo/package"

export function getCallbackUrl(provider: string, uriScheme?: string) {
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

// kilocode_change - new file

/**
 * Minimal safe JSON parse helper for webview code.
 *
 * This is a shim used via the webview-ui TS path alias `@roo/*` -> `../src/shared/*`.
 * Keep it browser-safe (no Node-only imports).
 */
export function safeJsonParse<T = unknown>(raw: string | undefined | null, fallback?: T): T {
	if (raw == null || raw === "") {
		return fallback as T
	}

	try {
		return JSON.parse(raw) as T
	} catch {
		return fallback as T
	}
}

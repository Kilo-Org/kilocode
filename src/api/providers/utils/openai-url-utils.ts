/**
 * Utility functions for OpenAI and OpenAI-compatible provider URL handling.
 * Handles URL normalization, schema enforcement, and provider-specific URL patterns.
 */

/**
 * Ensures that a URL string starts with https:// protocol.
 * If no protocol is present, https:// is prepended.
 * If http:// is present, it's converted to https://.
 * If already https://, it's returned as-is.
 */
export function ensureHttps(baseUrl: string): string {
	const trimmed = baseUrl.trim()
	if (!trimmed) return trimmed
	if (/^https:\/\//i.test(trimmed)) return trimmed
	if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, "https:")
	return `https://${trimmed}`
}

/**
 * Checks if a host string indicates an Azure OpenAI resource host.
 * Supports both *.openai.azure.com and *.cognitiveservices.azure.com patterns.
 */
export function isAzureOpenAiResourceHost(host: string): boolean {
	return host.endsWith(".openai.azure.com") || host.endsWith(".cognitiveservices.azure.com")
}

/**
 * Checks if a host string indicates Azure AI Inference service.
 * Matches *.services.ai.azure.com pattern.
 */
export function isAzureAiInferenceHost(host: string): boolean {
	return host.endsWith(".services.ai.azure.com")
}

// kilocode_change start
/**
 * Normalizes a base URL for OpenAI Responses API usage.
 * Returns a base WITHOUT the trailing `/responses` segment because the
 * OpenAI SDK adds `/responses` itself.
 *
 * Example mappings (input → base returned by this helper):
 * - myendpoint.openai.azure.com → https://myendpoint.openai.azure.com/openai/v1
 * - https://myendpoint.openai.azure.com/openai/v1/responses → https://myendpoint.openai.azure.com/openai/v1
 * - https://api.openai.com → https://api.openai.com/v1
 * - https://host/api/responses → https://host/api
 */
// kilocode_change end
export function normalizeOpenAiResponsesBaseUrl(rawBaseUrl: string): string {
	const url = ensureHttps(rawBaseUrl).trim()
	if (!url) return url

	try {
		const parsed = new URL(url)

		// For Responses API we must NEVER carry Azure `api-version` query param forward.
		// Other query params (if any) are preserved.
		parsed.searchParams.delete("api-version")
		const query = parsed.searchParams.toString()

		// Normalize path (drop trailing slashes)
		let pathname = parsed.pathname.replace(/\/+$/, "") || "/" // kilocode_change
		const host = parsed.host

		// kilocode_change start
		// Remove any trailing /responses because the SDK appends it automatically
		pathname = pathname.replace(/\/responses(?:\/responses)*$/i, "")

		const isAzureResource = isAzureOpenAiResourceHost(host)
		const isAzureInference = isAzureAiInferenceHost(host)
		const isOpenAiHost = host === "api.openai.com"

		let normalizedPath = pathname

		if (isOpenAiHost) {
			if (normalizedPath === "/" || normalizedPath === "") {
				normalizedPath = "/v1"
			} else if (!normalizedPath.endsWith("/v1")) {
				normalizedPath = `${normalizedPath}/v1`
			}
		} else if (isAzureResource || isAzureInference) {
			if (normalizedPath === "/" || normalizedPath === "") {
				normalizedPath = "/openai/v1"
			} else if (normalizedPath.endsWith("/openai")) {
				normalizedPath = `${normalizedPath}/v1`
			} else if (!normalizedPath.endsWith("/openai/v1")) {
				normalizedPath = `${normalizedPath}/openai/v1`
			}
		} else if (normalizedPath === "/" || normalizedPath === "") {
			normalizedPath = "/v1"
		}

		// Collapse duplicate slashes and trailing slash artifacts
		normalizedPath = normalizedPath.replace(/\/+/g, "/").replace(/\/+$/, "")

		// Ensure leading slash (in case pathname was emptied during normalization)
		if (!normalizedPath.startsWith("/")) {
			normalizedPath = `/${normalizedPath}`
		}
		// kilocode_change end

		const base = `${parsed.origin}${normalizedPath}`
		return query ? `${base}?${query}` : base
	} catch {
		// kilocode_change start
		// Fallback: best-effort string-based normalization (no query preservation)
		let base = ensureHttps(rawBaseUrl).split("?", 1)[0].replace(/\/+$/, "") // kilocode_change
		base = base.replace(/\/responses(?:\/responses)*$/i, "")
		if (!/\/v1$/i.test(base) && !/\/openai\/v1$/i.test(base)) {
			base = `${base}/v1`
		}
		// kilocode_change end
		return base
	}
}

/**
 * Extracts the host from a URL string.
 * Returns empty string if URL parsing fails.
 */
export function getUrlHost(baseUrl: string): string {
	try {
		return new URL(baseUrl).host
	} catch (error) {
		return ""
	}
}

import { createOpenRouter as createOpenRouterSdk } from "@openrouter/ai-sdk-provider"
import type { Provider as SDK } from "ai"
import type { KiloProviderOptions } from "./types.js"
import { getKiloUrlFromToken, getApiKey } from "./auth/token.js"
import { buildKiloHeaders, DEFAULT_HEADERS } from "./headers.js"
import { KILO_API_BASE, ANONYMOUS_API_KEY } from "./api/constants.js"
import { normalizeKiloOpenRouterURL } from "./url.js"

/**
 * Create a KiloCode provider instance
 *
 * This provider wraps the OpenRouter SDK with KiloCode-specific configuration
 * including custom authentication, headers, and base URL.
 *
 * @example
 * ```typescript
 * const provider = createKilo({
 *   kilocodeToken: "your-token-here",
 *   kilocodeOrganizationId: "org-123"
 * })
 *
 * const model = provider.languageModel("anthropic/claude-sonnet-4")
 * ```
 */
export function createKilo(options: KiloProviderOptions = {}): SDK {
  // Get API key from options or environment
  const apiKey = getApiKey(options)

  // Determine base URL
  const baseApiUrl = getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, apiKey ?? "")
  const normalized = normalizeKiloOpenRouterURL({
    baseURL: baseApiUrl,
    kilocodeOrganizationId: options.kilocodeOrganizationId,
  })

  // Merge custom headers with defaults
  const customHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: normalized.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...(options.headers ?? {}),
  }

  // Create custom fetch wrapper to add dynamic headers
  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)

    // Add custom headers
    for (const key in customHeaders) {
      headers.set(key, customHeaders[key])
    }

    // Add authorization if API key exists
    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`)
    }

    return originalFetch(input, {
      ...init,
      headers,
    })
  }

  // Create OpenRouter provider with KiloCode configuration
  return createOpenRouterSdk({
    baseURL: normalized.baseURL,
    apiKey: apiKey ?? ANONYMOUS_API_KEY,
    headers: customHeaders,
    fetch: wrappedFetch as typeof fetch,
  })
}

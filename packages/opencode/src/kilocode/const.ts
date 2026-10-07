import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://kilocode.ai",
  "X-Title": "Kilo Code",
  "User-Agent": `Kilo-Code/${InstallationVersion}`,
}

// DEFAULT_HEADERS for one request, minus the ones the provider was configured
// with (case-insensitive): a provider's own headers already go out with every
// request as the SDK's default headers, and a per-request header would replace
// them — e.g. OpenRouter's HTTP-Referer / X-Title app attribution set in config.
// User-Agent always stays Kilo's.
export function defaultHeaders(configured?: Record<string, string>) {
  const keys = new Set(Object.keys(configured ?? {}).map((key) => key.toLowerCase()))
  return Object.fromEntries(
    Object.entries(DEFAULT_HEADERS).filter(([key]) => key === "User-Agent" || !keys.has(key.toLowerCase())),
  )
}

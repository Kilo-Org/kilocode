import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://kilocode.ai",
  "X-Title": "Kilo Code",
  "User-Agent": `Kilo-Code/${InstallationVersion}`,
}

// DEFAULT_HEADERS for one request, with the values the provider was configured
// with for the same headers (case-insensitive) — e.g. OpenRouter's HTTP-Referer /
// X-Title app attribution set in config. Materialized here rather than just
// dropping the default, because some transports never see provider.options.headers
// (the Cloudflare AI Gateway loader builds its own clients). User-Agent always
// stays Kilo's.
export function defaultHeaders(configured?: Record<string, string>): Record<keyof typeof DEFAULT_HEADERS, string> {
  const values = new Map(Object.entries(configured ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    "HTTP-Referer": values.get("http-referer") ?? DEFAULT_HEADERS["HTTP-Referer"],
    "X-Title": values.get("x-title") ?? DEFAULT_HEADERS["X-Title"],
    "User-Agent": DEFAULT_HEADERS["User-Agent"],
  }
}

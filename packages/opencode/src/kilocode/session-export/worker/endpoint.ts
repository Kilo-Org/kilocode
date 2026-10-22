export const defaultEndpoint = "https://supermassive-black-hole.kiloapps.io/v1/session-export/batch"

const hosts = new Set(["supermassive-black-hole.kiloapps.io"])

export function resolveEndpoint(opts: { endpoint?: string; env?: string; allowCustom?: boolean }): string {
  const endpoint = opts.endpoint ?? opts.env ?? defaultEndpoint
  if (opts.allowCustom) return endpoint
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "https:") return defaultEndpoint
    if (!hosts.has(url.hostname)) return defaultEndpoint
    return endpoint
  } catch {
    return defaultEndpoint
  }
}

import type { EnterpriseSettings } from "./settings"

/** Effective Engine base URL: gateway + path, or absolute remote URL. */
export function engineBaseUrl(settings: EnterpriseSettings): string {
  if (!settings.remote.enabled) return ""
  const gateway = settings.gatewayUrl.replace(/\/+$/, "")
  const remote = settings.remote.url.trim()
  if (!remote) return gateway
  if (remote.startsWith("http://") || remote.startsWith("https://")) {
    return remote.replace(/\/+$/, "")
  }
  if (!gateway) return remote.replace(/\/+$/, "")
  const path = remote.startsWith("/") ? remote : `/${remote}`
  return `${gateway}${path}`.replace(/\/+$/, "")
}

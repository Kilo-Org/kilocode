import type { RemoteServerSettings } from "./settings"
import { remotePassword } from "./settings"

export type RemoteEndpoint = {
  baseUrl: string
  port: number
  password: string
}

export function remoteEndpoint(settings: RemoteServerSettings): RemoteEndpoint | null {
  if (!settings.enabled) return null
  const raw = settings.url.trim()
  if (!raw) return null

  const password = remotePassword(settings)
  if (!password) return null

  const baseUrl = raw.replace(/\/+$/, "")
  const port = portFromUrl(baseUrl)
  return { baseUrl, port, password }
}

function portFromUrl(baseUrl: string): number {
  const u = new URL(baseUrl)
  if (u.port) return Number(u.port)
  if (u.protocol === "https:") return 443
  return 80
}

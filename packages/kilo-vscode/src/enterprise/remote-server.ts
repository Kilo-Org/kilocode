import { engineBaseUrl } from "./gateway"
import type { EnterpriseSettings, RemoteServerSettings } from "./settings"
import { enterpriseSettings, remotePassword } from "./settings"
import { gatekeeperDirectRemote } from "../gatekeeper/remote-auth"

const SSO = "gatekeeper-sso"

export type RemoteEndpoint = {
  baseUrl: string
  port: number
  password: string
}

export function remoteEndpoint(settings?: EnterpriseSettings): RemoteEndpoint | null {
  const ent = settings ?? enterpriseSettings()
  const remote = ent.remote
  if (!remote.enabled) return null

  const raw = engineBaseUrl(ent)
  if (!raw) return null

  const password = remotePassword(remote)
  if (!password && !gatekeeperDirectRemote()) return null

  const baseUrl = raw.replace(/\/+$/, "")
  const port = portFromUrl(baseUrl)
  return { baseUrl, port, password: password || SSO }
}

function portFromUrl(baseUrl: string): number {
  const u = new URL(baseUrl)
  if (u.port) return Number(u.port)
  if (u.protocol === "https:") return 443
  return 80
}

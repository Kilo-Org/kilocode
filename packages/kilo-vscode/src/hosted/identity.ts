/**
 * Hosted session identity.
 *
 * A provider's native session id is not unique across providers, and the
 * extension keys its stores, tabs, and caches by a single string. Hosted
 * sessions therefore use a namespaced view key that can never collide with a
 * local session id or the legacy `cloud:` preview key.
 */
const PREFIX = "host:"

export interface HostedIdentity {
  providerID: string
  sessionID: string
}

export function hostedKey(providerID: string, sessionID: string): string {
  return `${PREFIX}${providerID}:${sessionID}`
}

export function isHostedKey(key: string | null | undefined): key is string {
  return typeof key === "string" && key.startsWith(PREFIX)
}

export function parseHostedKey(key: string | null | undefined): HostedIdentity | undefined {
  if (!isHostedKey(key)) return
  const rest = key.slice(PREFIX.length)
  const index = rest.indexOf(":")
  if (index <= 0) return
  const providerID = rest.slice(0, index)
  const sessionID = rest.slice(index + 1)
  if (!providerID || !sessionID) return
  return { providerID, sessionID }
}

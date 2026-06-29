import { randomUUID } from "node:crypto"
import type { SessionID } from "@/session/schema"

interface Grant {
  sessionID: SessionID
  directory: string
  expires: number
  remaining: number
}

const ttl = 24 * 60 * 60 * 1000
const grants = new Map<string, Grant>()

function cleanup(now = Date.now()) {
  for (const [token, grant] of grants) {
    if (grant.expires <= now || grant.remaining <= 0) grants.delete(token)
  }
}

export function issue(input: { sessionID: SessionID; directory: string; count: number }) {
  cleanup()
  const token = `si-${randomUUID()}`
  grants.set(token, {
    sessionID: input.sessionID,
    directory: input.directory,
    expires: Date.now() + ttl,
    remaining: Math.max(1, input.count),
  })
  return token
}

export function consume(token: string | undefined) {
  if (!token) return undefined
  cleanup()
  const grant = grants.get(token)
  if (!grant) return undefined
  grant.remaining--
  if (grant.remaining <= 0) grants.delete(token)
  return { sessionID: grant.sessionID, directory: grant.directory }
}

/**
 * Hosted stream framing.
 *
 * The local server relays the provider's native SSE frames unchanged. It does
 * not define a schema for them, so the client has to recognise three shapes:
 * ordinary events, generation fences, and full-resnapshot requests. Anything
 * unrecognised is forwarded as an event; a resnapshot always wins over a
 * concurrent event because continuity can no longer be proven.
 */
export type FrameKind = "event" | "fence" | "resnapshot" | "ignore"

export interface Frame {
  kind: FrameKind
  payload?: unknown
  directory?: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") return value as Record<string, unknown>
  return
}

export function classifyFrame(item: unknown): Frame {
  const envelope = object(item)
  if (!envelope) return { kind: "ignore" }
  const payload = object(envelope.payload) ?? envelope
  const type = typeof payload.type === "string" ? payload.type : undefined
  const directory = typeof envelope.directory === "string" ? envelope.directory : undefined
  if (!type) return { kind: "ignore" }
  if (type === "kilo.native.resnapshot") return { kind: "resnapshot", payload, directory }
  if (type === "kilo.native.fence") return { kind: "fence", payload, directory }
  return { kind: "event", payload, directory }
}

/**
 * Rewrites the native session identity carried by a hosted event to the
 * namespaced view key, so the existing renderer and stores can key on it
 * without knowing about attachments.
 */
export function retag(payload: unknown, sessionID: string, key: string): unknown {
  const event = object(payload)
  if (!event) return payload
  const properties = object(event.properties)
  if (!properties) return payload
  if (properties.sessionID !== sessionID) return payload
  const next: Record<string, unknown> = { ...properties, sessionID: key }
  for (const field of ["info", "part"]) {
    const value = object(properties[field])
    if (!value || value.sessionID !== sessionID) continue
    next[field] = { ...value, sessionID: key }
  }
  return { ...event, properties: next }
}

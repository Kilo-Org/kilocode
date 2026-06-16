import { ExportEventTypes, type ExportEventType } from "../envelope"
import type { ExportEvent } from "../events"
import type { ToWorker } from "./ipc"

const types = new Set<ExportEventType>(ExportEventTypes)

export function parseMessage(value: unknown): ToWorker | undefined {
  if (!plain(value)) return undefined
  switch (value.kind) {
    case "init":
      if (typeof value.dbPath !== "string") return undefined
      return {
        kind: "init",
        dbPath: value.dbPath,
        agentVersion: text(value.agentVersion),
        endpoint: text(value.endpoint),
        allowCustomEndpoint: value.allowCustomEndpoint === true,
        surface: text(value.surface),
        anonId: text(value.anonId),
      }
    case "event": {
      const envelope = parseEnvelope(value.envelope)
      if (!envelope) return undefined
      if (typeof value.approxBytes !== "number" || !Number.isFinite(value.approxBytes)) return undefined
      return { kind: "event", envelope, approxBytes: value.approxBytes }
    }
    case "shutdown":
      if (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs)) return undefined
      return { kind: "shutdown", timeoutMs: value.timeoutMs }
    case "network_reconnect":
      return { kind: "network_reconnect" }
    case "test_event_count":
      return { kind: "test_event_count" }
    default:
      return undefined
  }
}

function parseEnvelope(value: unknown): ExportEvent | undefined {
  if (!plain(value)) return undefined
  if (typeof value.id !== "string") return undefined
  if (value.schemaVersion !== 1) return undefined
  if (typeof value.type !== "string" || !types.has(value.type as ExportEventType)) return undefined
  if (typeof value.sessionId !== "string") return undefined
  if (typeof value.rootSessionId !== "string") return undefined
  if (typeof value.seq !== "number" || !Number.isFinite(value.seq)) return undefined
  if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) return undefined
  if (typeof value.agentVersion !== "string") return undefined
  return value as ExportEvent
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return true
}

import type { Event, GlobalEvent } from "@kilocode/sdk/v2"

type SyncEvent = Extract<GlobalEvent["payload"], { type: "sync" }>
type WireSyncEvent = {
  type: "sync"
  syncEvent: {
    type: string
    id: string
    seq: number
    aggregateID: string
    data: unknown
  }
}
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  workspace: string | undefined
}

// kilocode_change start - normalize the runtime SyncEvent wire envelope to the generated SDK shape
export function normalizeSyncEvent(payload: unknown): SyncEvent | undefined {
  if (!payload || typeof payload !== "object" || !("type" in payload) || payload.type !== "sync") return
  if ("name" in payload) return payload as SyncEvent
  if (!("syncEvent" in payload) || !payload.syncEvent || typeof payload.syncEvent !== "object") return

  const event = payload.syncEvent as WireSyncEvent["syncEvent"]
  if (
    typeof event.type !== "string" ||
    typeof event.id !== "string" ||
    typeof event.seq !== "number" ||
    typeof event.aggregateID !== "string" ||
    !("data" in event)
  )
    return

  return {
    type: "sync",
    name: event.type,
    id: event.id,
    seq: event.seq,
    aggregateID: event.aggregateID,
    data: event.data,
  } as SyncEvent
}
// kilocode_change end

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") return
      if (event.directory === "global" || event.project === project.project()) {
        handler(event.payload, { workspace: event.workspace })
      }
    })
  }

  function sync(handler: (event: SyncEvent, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      const payload = normalizeSyncEvent(event.payload)
      if (!payload) return
      if (event.directory === "global" || event.project === project.project()) {
        handler(payload, { workspace: event.workspace })
      }
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  function onSync<T extends SyncEvent["name"]>(
    name: T,
    handler: (event: Extract<SyncEvent, { name: T }>, metadata: EventMetadata) => void,
  ) {
    return sync((event: SyncEvent, metadata: EventMetadata) => {
      if (event.name !== name) return
      handler(event as Extract<SyncEvent, { name: T }>, metadata)
    })
  }

  return {
    subscribe,
    sync,
    on,
    onSync,
  }
}

// kilocode_change - new file
import type {
  Event as SDKEvent,
  GlobalEvent,
  SyncEventMessagePartRemoved,
  SyncEventMessagePartUpdated,
  SyncEventMessageRemoved,
  SyncEventMessageUpdated,
} from "@kilocode/sdk/v2"

type MessageUpdated = {
  id: string
  type: "message.updated"
  properties: SyncEventMessageUpdated["syncEvent"]["data"]
}

type MessageRemoved = {
  id: string
  type: "message.removed"
  properties: SyncEventMessageRemoved["syncEvent"]["data"]
}

type MessagePartUpdated = {
  id: string
  type: "message.part.updated"
  properties: SyncEventMessagePartUpdated["syncEvent"]["data"]
}

type MessagePartRemoved = {
  id: string
  type: "message.part.removed"
  properties: SyncEventMessagePartRemoved["syncEvent"]["data"]
}

export type Event = SDKEvent | MessageUpdated | MessageRemoved | MessagePartUpdated | MessagePartRemoved

export function event(payload: GlobalEvent["payload"]): Event | undefined {
  if (payload.type !== "sync") return payload

  const sync = payload.syncEvent
  switch (sync.type) {
    case "message.updated.1":
      return { id: sync.id, type: "message.updated", properties: sync.data }
    case "message.removed.1":
      return { id: sync.id, type: "message.removed", properties: sync.data }
    case "message.part.updated.1":
      return { id: sync.id, type: "message.part.updated", properties: sync.data }
    case "message.part.removed.1":
      return { id: sync.id, type: "message.part.removed", properties: sync.data }
    default:
      return undefined
  }
}

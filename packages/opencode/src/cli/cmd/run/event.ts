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
  properties: SyncEventMessageUpdated["data"]
}

type MessageRemoved = {
  id: string
  type: "message.removed"
  properties: SyncEventMessageRemoved["data"]
}

type MessagePartUpdated = {
  id: string
  type: "message.part.updated"
  properties: SyncEventMessagePartUpdated["data"]
}

type MessagePartRemoved = {
  id: string
  type: "message.part.removed"
  properties: SyncEventMessagePartRemoved["data"]
}

export type Event = SDKEvent | MessageUpdated | MessageRemoved | MessagePartUpdated | MessagePartRemoved

export function event(payload: GlobalEvent["payload"]): Event | undefined {
  if (payload.type !== "sync") return payload

  switch (payload.name) {
    case "message.updated.1":
      return { id: payload.id, type: "message.updated", properties: payload.data }
    case "message.removed.1":
      return { id: payload.id, type: "message.removed", properties: payload.data }
    case "message.part.updated.1":
      return { id: payload.id, type: "message.part.updated", properties: payload.data }
    case "message.part.removed.1":
      return { id: payload.id, type: "message.part.removed", properties: payload.data }
    default:
      return undefined
  }
}

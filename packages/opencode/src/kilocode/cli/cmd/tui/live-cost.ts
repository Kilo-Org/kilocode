import type { GlobalEvent, Part } from "@kilocode/sdk/v2"

type Sync = Extract<GlobalEvent["payload"], { type: "sync" }>

type Input = {
  parts: Record<string, readonly Part[] | undefined>
}

function cost(part: Part | undefined) {
  if (part?.type !== "step-finish") return 0
  return part.cost
}

export namespace KiloTuiLiveCost {
  export function delta(event: Sync, input: Input) {
    switch (event.name) {
      case "message.removed.1": {
        const total = (input.parts[event.data.messageID] ?? []).reduce((sum, part) => sum + cost(part), 0)
        if (total === 0) return undefined
        return { sessionID: event.data.sessionID, cost: -total }
      }
      case "message.part.updated.1": {
        const part = event.data.part
        const previous = input.parts[part.messageID]?.find((item) => item.id === part.id)
        const value = cost(part) - cost(previous)
        if (value === 0) return undefined
        return { sessionID: part.sessionID, cost: value }
      }
      case "message.part.removed.1": {
        const part = input.parts[event.data.messageID]?.find((item) => item.id === event.data.partID)
        const value = cost(part)
        if (value === 0) return undefined
        return { sessionID: event.data.sessionID, cost: -value }
      }
      default:
        return undefined
    }
  }
}

import { Binary } from "@opencode-ai/util/binary"
import type { SuggestionRequest } from "@kilocode/sdk/v2"

type RemovedEvent = {
  type: "suggestion.accepted" | "suggestion.dismissed"
  properties: {
    sessionID: string
    requestID: string
  }
}

type ShownEvent = {
  type: "suggestion.shown"
  properties: SuggestionRequest
}

type Event = RemovedEvent | ShownEvent

type Store = {
  suggestion: {
    [sessionID: string]: SuggestionRequest[]
  }
}

type SetStore = {
  (key: "suggestion", sessionID: string, value: SuggestionRequest[]): void
}

export function handleSuggestionEvent(event: Event, store: Store, setStore: SetStore) {
  if (event.type !== "suggestion.shown") {
    const info = event.properties
    const requests = store.suggestion[info.sessionID]
    if (!requests) return
    const match = Binary.search(requests, info.requestID, (r) => r.id)
    if (!match.found) return
    setStore("suggestion", info.sessionID, requests.toSpliced(match.index, 1))
    return
  }

  const request = event.properties
  const requests = store.suggestion[request.sessionID]
  if (!requests) {
    setStore("suggestion", request.sessionID, [request])
    return
  }
  const match = Binary.search(requests, request.id, (r) => r.id)
  if (match.found) {
    const next = [...requests]
    next[match.index] = request
    setStore("suggestion", request.sessionID, next)
    return
  }
  setStore("suggestion", request.sessionID, [
    ...requests.slice(0, match.index),
    request,
    ...requests.slice(match.index),
  ])
}

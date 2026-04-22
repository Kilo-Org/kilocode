import { EventEmitter } from "events"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

export const GlobalBus = new EventEmitter<{
  event: [GlobalEvent]
}>()
GlobalBus.setMaxListeners(50) // kilocode_change — surface warning if SSE listeners accumulate

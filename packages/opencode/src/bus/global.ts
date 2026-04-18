import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      project?: string
      workspace?: string
      payload: any
    },
  ]
}>()
GlobalBus.setMaxListeners(50) // kilocode_change — surface warning if SSE listeners accumulate

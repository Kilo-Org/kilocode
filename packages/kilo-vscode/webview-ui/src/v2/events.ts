import type { OpenCodeEvent } from "@opencode/client"
import type { CreateDataInput } from "@opencode/client/solid"

type EventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export function events() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  const event: CreateDataInput["event"] = {
    on(type, handler) {
      const listener = (event: OpenCodeEvent) => {
        if (matches(event, type)) handler(event)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listen(handler) {
      const listener = (event: OpenCodeEvent) => handler({ name: event.type, details: event })
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    ...event,
    emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener(event)),
    clear: () => listeners.clear(),
  }
}

function matches<Type extends OpenCodeEvent["type"]>(event: OpenCodeEvent, type: Type): event is EventMap[Type] {
  return event.type === type
}

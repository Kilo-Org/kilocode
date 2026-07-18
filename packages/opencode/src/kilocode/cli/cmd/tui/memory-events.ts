type Event = {
  on(type: "memory.error", fn: (event: MemoryEvent) => void): void | (() => void)
}

type MemoryEvent = {
  properties: {
    sessionID?: string
    detail?: unknown
    reason?: string
  }
}

type Toast = {
  show(input: { message: string; variant: "error" | "info" | "success"; duration: number }): void
}

export namespace MemoryTuiEvents {
  export function attach(input: {
    event: Event
    toast: Toast
    sessionID: string
  }) {
    const handler = (event: MemoryEvent) => {
      if (event.properties.sessionID && event.properties.sessionID !== input.sessionID) return
      const detail = event.properties.detail
      if (!detail || typeof detail !== "object") {
        input.toast.show({
          message: `Memory error${event.properties.reason ? ` · ${event.properties.reason}` : ""}`,
          variant: "error",
          duration: 3500,
        })
        return
      }
      const item = detail as { message?: unknown }
      if (typeof item.message !== "string") return
      input.toast.show({ message: item.message, variant: "error", duration: 3500 })
    }
    const dispose = [input.event.on("memory.error", handler)]
    return () => dispose.forEach((fn) => (typeof fn === "function" ? fn() : undefined))
  }
}

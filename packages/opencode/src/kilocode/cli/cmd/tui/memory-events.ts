type Event = {
  on(type: "memory.status" | "memory.updated" | "memory.error", fn: (event: MemoryEvent) => void): void | (() => void)
}

type MemoryEvent = {
  properties: {
    sessionID?: string
    detail?: unknown
  }
}

type Toast = {
  show(input: { message: string; variant: "info" | "success"; duration: number }): void
}

export namespace MemoryTuiEvents {
  export function attach(input: { event: Event; toast: Toast; sessionID: string }) {
    const seen = { last: "" }
    const recalled = new Set<string>()
    const handler = (event: MemoryEvent) => {
      if (event.properties.sessionID && event.properties.sessionID !== input.sessionID) return
      const detail = event.properties.detail
      if (!detail || typeof detail !== "object") return
      const item = detail as { type?: unknown; message?: unknown; files?: unknown; sources?: unknown }
      if (item.type === "skipped") return
      if (typeof item.message !== "string") return
      const session = event.properties.sessionID ?? input.sessionID
      if (item.type === "recalled") {
        const files = Array.isArray(item.files)
          ? item.files.filter((file): file is string => typeof file === "string")
          : []
        const sources = Array.isArray(item.sources)
          ? item.sources.filter((source): source is string => typeof source === "string")
          : []
        const key = `${session}:${[...files, ...sources].sort().join(",") || item.message}`
        if (recalled.has(key)) return
        recalled.add(key)
      }
      const key = `${session}:${String(item.type)}:${item.message}`
      if (key === seen.last) return
      seen.last = key
      input.toast.show({
        message: item.message,
        variant: item.type === "saved" ? "success" : "info",
        duration: 3500,
      })
    }
    const dispose = [
      input.event.on("memory.status", handler),
      input.event.on("memory.updated", handler),
      input.event.on("memory.error", handler),
    ]
    return () => dispose.forEach((fn) => (typeof fn === "function" ? fn() : undefined))
  }
}

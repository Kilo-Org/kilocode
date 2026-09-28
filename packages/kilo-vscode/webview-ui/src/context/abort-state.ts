type Entry = {
  phase: "pending" | "active"
  messageID?: string
  preserve?: boolean
}

export function createAbortState() {
  const entries = new Map<string, Entry>()

  return {
    request(id: string, status: string, messageID?: string, preserve = false) {
      const entry = entries.get(id)
      if (entry?.phase === "active") return status !== "idle"
      if (entry) {
        if (preserve) entry.preserve = true
        return false
      }
      if (status === "idle") {
        if (!messageID) return false
        entries.set(id, { phase: "pending", messageID, preserve })
        return false
      }
      entries.set(id, { phase: "active" })
      return true
    },
    move(from: string, to: string) {
      const source = entries.get(from)
      if (!source) return
      entries.delete(from)
      const target = entries.get(to)
      if (target?.phase === "active") return
      entries.set(to, source)
    },
    update(id: string, status: string) {
      const entry = entries.get(id)
      if (!entry) return false
      if (status === "idle") {
        if (!entry.preserve) entries.delete(id)
        return false
      }
      if (entry.phase === "active") return false
      entries.set(id, { phase: "active" })
      return true
    },
    finish(messageID: string) {
      for (const [id, entry] of entries) {
        if (entry.phase === "pending" && entry.messageID === messageID) entries.delete(id)
      }
    },
    clear(id: string) {
      entries.delete(id)
    },
  }
}

type Part = {
  type: string
  metadata?: {
    kiloMemory?: unknown
  }
}

export namespace MemoryTuiMeta {
  export function fromParts(parts: readonly Part[]) {
    for (const part of parts) {
      if (part.type !== "text") continue
      const meta = part.metadata?.kiloMemory
      if (!meta || typeof meta !== "object") continue
      const value = meta as { type?: unknown; tokens?: unknown; count?: unknown; files?: unknown; sources?: unknown }
      const type = value.type === "startup" ? "startup" : "recall"
      const tokens = typeof value.tokens === "number" ? value.tokens : 0
      const files = Array.isArray(value.files)
        ? value.files.filter((item) => typeof item === "string")
        : Array.isArray(value.sources)
          ? value.sources.filter((item) => typeof item === "string")
          : []
      const count = typeof value.count === "number" ? value.count : files.length
      return { type, tokens, count }
    }
    return undefined
  }
}

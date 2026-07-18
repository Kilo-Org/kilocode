export namespace MemoryMarkerMeta {
  const LIMIT = 5
  const CHARS = 120

  export type Type = "recall" | "startup"

  export type Info = {
    type: Type
    bytes: number
    tokens: number
    count: number
    files: string[]
    items: string[]
  }

  export type Part = {
    type: string
    metadata?: Record<string, unknown> & {
      kiloMemory?: unknown
    }
  }

  export type Decoded = {
    type: Type
    tokens: number
    count: number
    files: string[]
    items: string[]
  }

  export function metadata(marker: Info, verbose = false) {
    return {
      kiloMemory: {
        type: marker.type,
        bytes: marker.bytes,
        tokens: marker.tokens,
        count: marker.count,
        files: marker.files,
        ...(verbose && marker.type === "recall" ? { items: marker.items } : {}),
      },
    }
  }

  function header(line: string) {
    if (!line.startsWith("record ")) return
    return line
  }

  function source(line: string) {
    for (const field of line.split(" ")) {
      if (!field.startsWith("source=")) continue
      const value = field.slice("source=".length)
      if (value) return value
    }
  }

  function clip(input: string) {
    return Array.from(input).slice(0, CHARS).join("")
  }

  function list(input: readonly string[]) {
    return input.filter(Boolean).slice(0, LIMIT).map(clip)
  }

  function item(line: string) {
    if (!line.startsWith("text:")) return
    const value = line.slice("text:".length).trim()
    const idx = value.indexOf(" :: ")
    return (idx >= 0 ? value.slice(idx + 4) : value).trim()
  }

  function items(input: string) {
    return list(input.split("\n").map(item).filter((value) => value !== undefined))
  }

  export function snippets(input: Decoded | undefined, verbose: boolean) {
    if (!verbose || input?.type !== "recall") return []
    return input.items
  }

  export function fromBlocks(blocks: readonly { text: string; bytes: number; estimatedTokens: number }[]) {
    const records = blocks.flatMap((block) =>
      block.text
        .split("\n")
        .map(header)
        .filter((line) => line !== undefined),
    )
    if (records.length === 0) return
    const files = [...new Set(records.map(source).filter((file) => file !== undefined))]
    return {
      type: "startup",
      bytes: blocks.reduce((sum, block) => sum + block.bytes, 0),
      tokens: blocks.reduce((sum, block) => sum + block.estimatedTokens, 0),
      count: records.length,
      files,
      items: [],
    } satisfies Info
  }

  export function fromRecall(input: { output?: string; metadata?: Record<string, unknown>; tokens: number }) {
    const files = Array.isArray(input.metadata?.sources)
      ? input.metadata.sources.filter((file) => typeof file === "string")
      : []
    if (files.length === 0) return
    const text = input.output ?? ""
    return {
      type: "recall",
      bytes: Buffer.byteLength(text),
      tokens: input.tokens,
      count: typeof input.metadata?.count === "number" ? input.metadata.count : files.length,
      files: [...new Set(files)],
      items: items(text),
    } satisfies Info
  }

  export function fromParts(parts: readonly Part[]): Decoded | undefined {
    for (const part of parts) {
      if (part.type !== "text") continue
      const meta = part.metadata?.kiloMemory
      if (!meta || typeof meta !== "object") continue
      const value = meta as {
        type?: unknown
        tokens?: unknown
        count?: unknown
        files?: unknown
        sources?: unknown
        items?: unknown
      }
      const type = value.type === "startup" ? "startup" : "recall"
      const tokens = typeof value.tokens === "number" ? value.tokens : 0
      // `sources` fallback covers parts persisted before the key was dropped from metadata().
      const files = Array.isArray(value.files)
        ? value.files.filter((item) => typeof item === "string")
        : Array.isArray(value.sources)
          ? value.sources.filter((item) => typeof item === "string")
          : []
      const count = typeof value.count === "number" ? value.count : files.length
      const items = Array.isArray(value.items)
        ? list(value.items.filter((item): item is string => typeof item === "string"))
        : []
      return { type, tokens, count, files, items }
    }
    return undefined
  }
}

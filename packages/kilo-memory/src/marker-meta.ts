export namespace MemoryMarkerMeta {
  export type Type = "recall" | "startup"

  export type Info = {
    type: Type
    bytes: number
    tokens: number
    count: number
    files: string[]
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
  }

  export function metadata(marker: Info) {
    return {
      kiloMemory: {
        type: marker.type,
        bytes: marker.bytes,
        tokens: marker.tokens,
        count: marker.count,
        files: marker.files,
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
    } satisfies Info
  }

  export function fromParts(parts: readonly Part[]): Decoded | undefined {
    for (const part of parts) {
      if (part.type !== "text") continue
      const meta = part.metadata?.kiloMemory
      if (!meta || typeof meta !== "object") continue
      const value = meta as { type?: unknown; tokens?: unknown; count?: unknown; files?: unknown; sources?: unknown }
      const type = value.type === "startup" ? "startup" : "recall"
      const tokens = typeof value.tokens === "number" ? value.tokens : 0
      // `sources` fallback covers parts persisted before the key was dropped from metadata().
      const files = Array.isArray(value.files)
        ? value.files.filter((item) => typeof item === "string")
        : Array.isArray(value.sources)
          ? value.sources.filter((item) => typeof item === "string")
          : []
      const count = typeof value.count === "number" ? value.count : files.length
      return { type, tokens, count, files }
    }
    return undefined
  }
}

import { Token } from "@/util/token"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { PartID, type SessionID } from "@/session/schema"
import type { KiloMemory } from "@kilocode/kilo-memory/effect"

export namespace MemoryMarker {
  export type Info = {
    type: "recall" | "startup"
    bytes: number
    tokens: number
    count: number
    files: string[]
  }

  export type Cache = {
    marker?: Info
    marked?: boolean
  }

  function header(line: string) {
    if (!line.startsWith("record ")) return
    return line
  }

  function source(line: string) {
    for (const field of line.split(" ")) {
      if (!field.startsWith("source=")) continue
      const value = field.slice("source=".length)
      if (value && value !== "metadata") return value
    }
  }

  export function fromBlocks(blocks: KiloMemory.Block[]): Info | undefined {
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
    }
  }

  export function startup(input: { marker?: Info; cache: Cache }) {
    if (input.cache.marker) return
    if (!input.marker || input.marker.count === 0) return
    input.cache.marker = input.marker
  }

  export function recall(input: { result: { output?: string; metadata?: Record<string, unknown> }; cache: Cache }) {
    const meta = input.result.metadata
    const files = Array.isArray(meta?.files) ? meta.files.filter((file) => typeof file === "string") : []
    if (files.length === 0) return
    const text = input.result.output ?? ""
    input.cache.marker = {
      type: "recall",
      bytes: Buffer.byteLength(text),
      tokens: Token.estimate(text),
      count: typeof meta?.count === "number" ? meta.count : files.length,
      files: [...new Set(files)],
    }
    input.cache.marked = false
  }

  export function part(input: { sessionID: SessionID; message: MessageV2.Assistant; cache: Cache }) {
    const marker = input.cache.marker
    if (!marker || marker.count === 0) return
    if (input.cache.marked) return
    input.cache.marked = true
    return {
      id: PartID.make(Identifier.ascending("part")),
      sessionID: input.sessionID,
      messageID: input.message.id,
      type: "text",
      text: "",
      synthetic: true,
      ignored: true,
      metadata: {
        kiloMemory: {
          type: marker.type,
          bytes: marker.bytes,
          tokens: marker.tokens,
          count: marker.count,
          files: marker.files,
          sources: marker.files,
        },
      },
    } satisfies MessageV2.TextPart
  }
}

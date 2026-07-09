import { Token } from "@/util/token"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { PartID, type SessionID } from "@/session/schema"
import type { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"

export namespace MemoryMarker {
  export type Info = MemoryMarkerMeta.Info

  export type Cache = {
    marker?: Info
    marked?: boolean
  }

  export function fromBlocks(blocks: KiloMemory.Block[]): Info | undefined {
    return MemoryMarkerMeta.fromBlocks(blocks)
  }

  export function startup(input: { marker?: Info; cache: Cache }) {
    if (input.cache.marker) return
    if (!input.marker || input.marker.count === 0) return
    input.cache.marker = input.marker
  }

  export function recall(input: { result: { output?: string; metadata?: Record<string, unknown> }; cache: Cache }) {
    const marker = MemoryMarkerMeta.fromRecall({
      output: input.result.output,
      metadata: input.result.metadata,
      tokens: Token.estimate(input.result.output ?? ""),
    })
    if (!marker) return
    input.cache.marker = marker
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
      metadata: MemoryMarkerMeta.metadata(marker),
    } satisfies MessageV2.TextPart
  }
}

import type { ExportEvent } from "../events"
import type { Chunker } from "./chunks"
import type { Scrubber } from "./scrub"
import type { Storage } from "./storage"

export type HandlerCtx = {
  storage: Storage
  chunker: Chunker
  scrubber: Scrubber
  inlineThresholdBytes: number
  maxPayloadBytes?: number
}

const ENVELOPE = new Set([
  "id",
  "schemaVersion",
  "type",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "requestId",
  "seq",
  "ts",
  "agentVersion",
])

export async function handleEvent(envelope: ExportEvent, ctx: HandlerCtx): Promise<void> {
  const result = ctx.scrubber.scrubEvent(envelope)
  const payload = await normalizeToolIo(result.data, ctx)
  const chunked = await chunkLargeStrings(payload, ctx)
  const dataJson = JSON.stringify(chunked)

  ctx.storage.insertEvent({
    id: envelope.id,
    schemaVersion: envelope.schemaVersion,
    sessionId: envelope.sessionId,
    rootSessionId: envelope.rootSessionId,
    parentSessionId: envelope.parentSessionId,
    seq: envelope.seq,
    requestId: envelope.requestId,
    type: envelope.type,
    ts: envelope.ts,
    agentVersion: envelope.agentVersion,
    dataJson,
    clientScrubbed: result.success ? 1 : 0,
  })
}

async function normalizeToolIo(envelope: ExportEvent, ctx: HandlerCtx): Promise<unknown> {
  const payload = stripEnvelopeFields(envelope)
  if (envelope.type !== "tool_executed") return payload
  const out = { ...(payload as Record<string, unknown>) }
  if (envelope.toolInput !== undefined) {
    out.inputChunkIds = await ctx.chunker.write(Buffer.from(JSON.stringify(envelope.toolInput), "utf8"))
    delete out.toolInput
  }
  if (envelope.toolOutput !== undefined) {
    out.outputChunkIds = await ctx.chunker.write(Buffer.from(envelope.toolOutput, "utf8"))
    delete out.toolOutput
  }
  return out
}

function stripEnvelopeFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input)) {
    if (!ENVELOPE.has(key)) out[key] = val
  }
  return out
}

async function chunkLargeStrings(node: unknown, ctx: HandlerCtx): Promise<unknown> {
  if (typeof node === "string") {
    const bytes = Buffer.from(node, "utf8")
    const original = bytes.byteLength
    const limit = ctx.maxPayloadBytes ?? Number.POSITIVE_INFINITY
    const kept = original > limit ? bytes.subarray(0, limit) : bytes
    if (kept.byteLength <= ctx.inlineThresholdBytes && original <= limit) return node
    const ids = await ctx.chunker.write(kept)
    return {
      __chunked: true,
      chunkIds: ids,
      size: kept.byteLength,
      encoding: "utf8",
      truncated: original > limit,
      originalSize: original,
    }
  }
  if (Array.isArray(node)) {
    const out: unknown[] = []
    for (const item of node) out.push(await chunkLargeStrings(item, ctx))
    return out
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(node)) out[key] = await chunkLargeStrings(val, ctx)
    return out
  }
  return node
}

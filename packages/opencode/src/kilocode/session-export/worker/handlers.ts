import type { ExportEvent } from "../events"
import type { Chunker } from "./chunks"
import { isHighRiskPath, type Scrubber } from "./scrub"
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
  "seq",
  "ts",
  "agentVersion",
])

const IDENTITY = new Set(["accountid", "email", "org", "orgid", "organizationid", "kilo_org_id"])
const METADATA = new Set(["eventSeq", "time", "durationMs", "retryCount", "requestedAt", "durationToDecideMs"])

export async function handleEvent(envelope: ExportEvent, ctx: HandlerCtx): Promise<void> {
  const result = await ctx.scrubber.scrubEvent(envelope)
  if (!result.success) return
  const payload = await normalizePayload(result.data, ctx)
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

async function normalizePayload(envelope: ExportEvent, ctx: HandlerCtx): Promise<unknown> {
  const payload = stripIdentity(stripEnvelopeFields(envelope))
  if (envelope.type === "workspace_baseline_completed") return normalizeBaseline(payload, ctx)
  if (envelope.type === "workspace_delta_captured") return normalizeDelta(payload, ctx)
  if (envelope.type === "llm_request_completed") return normalizeCompletion(payload)
  if (envelope.type === "compaction_captured") return normalizeCompaction(payload)
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

async function normalizeBaseline(payload: unknown, ctx: HandlerCtx): Promise<unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const out = { ...(payload as Record<string, unknown>) }
  delete out.snapshotId
  delete out.capture
  delete out.truncated
  delete out.originalFileCount
  delete out.originalTotalSize
  if (!Array.isArray(out.files)) return out
  const files: unknown[] = []
  for (const file of out.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      files.push(file)
      continue
    }
    const item = file as Record<string, unknown>
    if (typeof item.path === "string" && isHighRiskPath(item.path)) {
      files.push({ path: item.path, kind: item.kind, omitted: { reason: "high_risk_path" } })
      continue
    }
    const next = { ...item }
    if (typeof next.content === "string") {
      const bytes = Buffer.from(next.content, "utf8")
      next.chunkIds = await ctx.chunker.write(bytes)
      next.encoding = "utf8"
      next.size = typeof next.size === "number" ? next.size : bytes.byteLength
      delete next.content
    }
    files.push(next)
  }
  out.files = files
  return out
}

function normalizeCompletion(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const out = { ...(payload as Record<string, unknown>) }
  const output = out.output
  if (!output || typeof output !== "object" || Array.isArray(output)) return out
  const next = { ...(output as Record<string, unknown>) }
  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = next.toolCalls.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item
      const call = { ...(item as Record<string, unknown>) }
      delete call.output
      return call
    })
  }
  out.output = next
  return out
}

async function normalizeDelta(payload: unknown, ctx: HandlerCtx): Promise<unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const out = { ...(payload as Record<string, unknown>) }
  delete out.snapshotHash
  delete out.prevSnapshotHash
  if (!Array.isArray(out.diff)) return out
  const diff: unknown[] = []
  for (const item of out.diff) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      diff.push(item)
      continue
    }
    const next = { ...(item as Record<string, unknown>) }
    if (typeof next.path === "string" && isHighRiskPath(next.path)) {
      next.patchChunkIds = []
      delete next.patch
      diff.push(next)
      continue
    }
    if (typeof next.patch === "string") {
      next.patchChunkIds = await ctx.chunker.write(Buffer.from(next.patch, "utf8"))
      delete next.patch
    }
    diff.push(next)
  }
  out.diff = diff
  return out
}

function normalizeCompaction(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const out = { ...(payload as Record<string, unknown>) }
  delete out.modelId
  delete out.usage
  const input = out.input
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const next = { ...(input as Record<string, unknown>) }
    delete next.selectedContext
    delete next.tailStartId
    out.input = next
  }
  const output = out.output
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const next = { ...(output as Record<string, unknown>) }
    delete next.assistantMessageId
    out.output = next
  }
  return out
}

function stripEnvelopeFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input)) {
    if (!ENVELOPE.has(key)) out[key] = val
  }
  return stripMetadata(out)
}

function stripMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input)) {
    if (!METADATA.has(key)) out[key] = val
  }
  return out
}

function stripIdentity(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripIdentity)
  if (!node || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(node)) {
    if (IDENTITY.has(key.toLowerCase())) continue
    out[key] = stripIdentity(val)
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

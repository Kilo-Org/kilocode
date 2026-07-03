import z from "zod"
import { MemoryOperations } from "./ops"
import digest from "../prompts/session-digest.txt"
import typed from "../prompts/typed-consolidation.txt"

export const typedPrompt = typed
export const digestPrompt = digest

const skip = z
  .enum([
    "duplicate",
    "transient",
    "unsupported",
    "secret",
    "too_specific",
    "in_progress",
    "policy_belongs_in_docs",
    "out_of_scope",
    "self_referential",
    "quota_guard",
    "rate_limit_guard",
  ])
  .catch("unsupported")

const key = z.string().trim().min(1).max(80)
const value = z.string().trim().min(1).max(2_000)
const addSchema = (
  op: "upsert_project_fact" | "upsert_project_decision" | "upsert_project_constraint" | "append_correction",
) => z.object({ op: z.literal(op), key, value }).strict()

// A single operation. Salvage validates each element against this so one bad op cannot void the batch.
export const opSchema = z.discriminatedUnion("op", [
  addSchema("upsert_project_fact"),
  addSchema("upsert_project_decision"),
  addSchema("upsert_project_constraint"),
  addSchema("append_correction"),
  z
    .object({
      op: z.literal("upsert_environment_fact"),
      key,
      value,
      section: z.enum(["Commands", "Paths", "Tooling", "commands", "paths", "tooling"]),
    })
    .strict(),
  z.object({ op: z.literal("remove_memory"), query: z.string().trim().min(1).max(240) }).strict(),
  z
    .object({
      op: z.literal("noop"),
      key: z.string().max(80).optional(),
      value: z.string().max(2_000).optional(),
    })
    .strict(),
])

const skipEntrySchema = z
  .object({
    reason: skip,
    text: z.string().max(500).optional(),
    duplicateOf: z.string().max(240).optional(),
    // Optional scope of the entry this skip claims to duplicate, so duplicate verification
    // matches within the same file/section instead of across all stored memory.
    file: z.enum(["project.md", "environment.md", "corrections.md"]).optional(),
    section: z.string().max(80).optional(),
  })
  .strict()

export const typedSchema = z
  .object({
    operations: z.array(opSchema).max(16),
    skipped: z.array(skipEntrySchema).max(32).default([]),
  })
  .strict()

export const digestSchema = z
  .object({
    topic: z.string().max(160).default(""),
    summary: z.string().max(4_000).default(""),
  })
  .strict()

export type CaptureSkip = z.infer<typeof typedSchema>["skipped"][number]
export type CaptureDigest = z.infer<typeof digestSchema>

function clean(input: string) {
  return input
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

// Extract the first balanced {...} block so model preamble/suffix ("Here is the JSON: {...}") does not
// break JSON.parse. String contents (including braces inside strings) are skipped.
function extract(input: string) {
  const start = input.indexOf("{")
  if (start < 0) return input
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < input.length; i++) {
    const ch = input[i]!
    if (esc) {
      esc = false
      continue
    }
    if (inStr) {
      if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return input.slice(start, i + 1)
    }
  }
  return input.slice(start)
}

function decode(input: string): unknown {
  if (Buffer.byteLength(input) > 64_000) throw new Error("memory model output exceeds 64000 bytes")
  return JSON.parse(extract(clean(input)))
}

export function parseJson<T>(schema: z.ZodType<T>, input: string) {
  return schema.parse(decode(input))
}

function opText(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined
  const record = item as Record<string, unknown>
  const raw = [record.value, record.query, record.key].find((field) => typeof field === "string") as
    | string
    | undefined
  const text = raw?.trim().slice(0, 500)
  return text || undefined
}

/** Per-op salvage: parse the batch leniently, validate each op individually, keep the valid ones, and
 * record the rest as `unsupported` skips. One malformed op, an over-cap op, or an over-length value no
 * longer voids the whole typed batch; the >16 overflow is truncated instead of failing. Invalid JSON
 * still throws so the caller's fallback path fires. */
export function salvageTyped(input: string): z.infer<typeof typedSchema> {
  const decoded = decode(input)
  const root = (decoded && typeof decoded === "object" ? decoded : {}) as Record<string, unknown>
  const rawOps = Array.isArray(root.operations) ? root.operations : []
  const operations: z.infer<typeof opSchema>[] = []
  const salvage: CaptureSkip[] = []
  for (const item of rawOps) {
    if (operations.length >= 16) break
    const parsed = opSchema.safeParse(item)
    if (parsed.success) {
      operations.push(parsed.data)
      continue
    }
    const text = opText(item)
    if (text) salvage.push({ reason: "unsupported", text })
  }
  const rawSkips = Array.isArray(root.skipped) ? root.skipped : []
  const skipped: CaptureSkip[] = []
  for (const item of rawSkips) {
    const parsed = skipEntrySchema.safeParse(item)
    if (parsed.success) skipped.push(parsed.data)
  }
  return { operations, skipped: [...skipped, ...salvage].slice(0, 32) }
}

function add(op: { key: string; value: string }, file: MemoryOperations.Add["file"], section?: string) {
  const key = op.key.trim()
  const body = op.value.trim()
  if (!key || !body) return []
  return [{ action: "add", file, section, key, text: body }] satisfies MemoryOperations.Op[]
}

function env(input: string | undefined) {
  const text = input?.trim().toLowerCase()
  if (text === "paths" || text === "path") return "Paths"
  if (text === "tooling" || text === "tools" || text === "tool") return "Tooling"
  return "Commands"
}

export function parseOps(input: z.infer<typeof typedSchema>): MemoryOperations.Op[] {
  return input.operations.flatMap((op): MemoryOperations.Op[] => {
    if (op.op === "remove_memory") return [{ action: "remove", query: op.query.trim() }]
    if (op.op === "append_correction") return add(op, "corrections.md", "Corrections")
    if (op.op === "upsert_project_decision") return add(op, "project.md", "Decisions")
    if (op.op === "upsert_project_constraint") return add(op, "project.md", "Constraints")
    if (op.op === "upsert_project_fact") return add(op, "project.md", "Facts")
    if (op.op === "upsert_environment_fact") return add(op, "environment.md", env(op.section))
    return []
  })
}

export function mergeOps(ops: MemoryOperations.Op[]) {
  const result: MemoryOperations.Op[] = []
  for (const item of ops) {
    if (item.action === "remove") {
      if (!result.some((prior) => prior.action === "remove" && prior.query === item.query)) result.push(item)
      continue
    }
    if (
      !result.some(
        (prior) =>
          prior.action === "add" &&
          prior.file === item.file &&
          prior.section === item.section &&
          prior.key === item.key,
      )
    ) {
      result.push(item)
    }
  }
  return result
}

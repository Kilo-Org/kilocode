import z from "zod"
import { MemoryOperations } from "./ops"
import { MemoryDigest } from "./digest"
import { MemoryRedact } from "./redact"
import { MemoryShared } from "../recall/shared"
import type { MemoryFiles } from "../storage/store"
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
) =>
  z.object({ op: z.literal(op), key, value }).strict()

export const typedSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("op", [
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
        ]),
      )
      .max(16),
    skipped: z
      .array(
        z
          .object({
            reason: skip,
            text: z.string().max(500).optional(),
            duplicateOf: z.string().max(240).optional(),
          })
          .strict(),
      )
      .max(32)
      .default([]),
  })
  .strict()

export const digestSchema = z
  .object({
    topic: z.string().max(160).default(""),
    summary: z.string().max(4_000).default(""),
  })
  .strict()

function clean(input: string) {
  return input
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

export function parseJson<T>(schema: z.ZodType<T>, input: string) {
  if (Buffer.byteLength(input) > 64_000) throw new Error("memory model output exceeds 64000 bytes")
  return schema.parse(JSON.parse(clean(input)))
}

type Raw = z.infer<typeof typedSchema>["operations"][number]

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

export type CaptureReason = "completed" | "error" | "interrupted"
export type CaptureSkip = z.infer<typeof typedSchema>["skipped"][number]
export type CaptureSourceItem = { id: string; text: string }

export type CaptureDiff = {
  file?: string
  status?: string
  additions: number
  deletions: number
}

export type CaptureDetail = {
  type: "saved" | "skipped"
  message: string
  tokens?: number
  operationCount?: number
  skippedCount?: number
  sources?: string[]
  files?: string[]
}

const durable =
  /(^|\/)(AGENTS\.md|README|docs?\/|package\.json|bun\.lock|pnpm-lock\.yaml|package-lock\.json|turbo\.json|tsconfig[^/]*\.json|vite\.config|eslint|biome|prettier|kilo\.json|\.kilo\/|[^/]*(test|spec|config|command|agent|workflow)[^/]*\.(ts|tsx|js|json|md|yml|yaml))$/i

export function hasDurableDiff(diffs: Pick<CaptureDiff, "file" | "additions" | "deletions">[]) {
  return diffs.some((item) => {
    const file = item.file ?? ""
    if (!file) return false
    if (durable.test(file)) return true
    return item.additions + item.deletions >= 20 && /\.(md|json|ya?ml|toml|ts|tsx|js)$/.test(file)
  })
}

export function summarizeDiffs(diffs: Pick<CaptureDiff, "file" | "status" | "additions" | "deletions">[]) {
  return diffs
    .filter((item) => item.file)
    .slice(0, 20)
    .map((item) => {
      const status = item.status ?? "modified"
      return `${status} ${item.file} +${item.additions} -${item.deletions}`
    })
    .join("\n")
}

export function cap(input: string, max: number) {
  if (Buffer.byteLength(input) <= max) return input
  const chars: string[] = []
  let bytes = 0
  for (const char of input) {
    const size = Buffer.byteLength(char)
    if (bytes + size > max) break
    chars.push(char)
    bytes += size
  }
  return chars.join("")
}

function body(input: string | undefined, fallback = "(empty)") {
  const text = MemoryRedact.text(input?.trim().replaceAll("```", "'''") ?? "")
  return text || fallback
}

export function evidence(sections: { title: string; body?: string }[]) {
  return [
    "```kilo-memory-evidence-v1",
    ...sections.flatMap((section) => [`## ${section.title}`, body(section.body)]),
    "```",
  ].join("\n")
}

export function summarize(input: { user: string; assistant: string; max: number }) {
  const user = MemoryShared.brief(MemoryRedact.text(input.user), Math.max(24, Math.floor(input.max * 0.45)))
  const assistant = MemoryShared.brief(MemoryRedact.text(input.assistant), Math.max(24, Math.floor(input.max * 0.45)))
  const text = [user ? `User: ${user}` : "", assistant ? `Result: ${assistant}` : ""].filter(Boolean).join(" ")
  return MemoryShared.brief(text, input.max)
}

export function fallbackDigest(input: { prior?: string; summary: string; max: number }) {
  if (!input.prior?.trim()) return MemoryShared.brief(input.summary, input.max)
  const prior = MemoryShared.brief(input.prior ?? "", Math.max(0, Math.floor(input.max * 0.55)))
  const latest = MemoryShared.brief(input.summary, Math.max(0, input.max - prior.length - 9))
  return MemoryShared.brief([prior, latest ? `Latest: ${latest}` : ""].filter(Boolean).join(" "), input.max)
}

export function parseDigest(input: z.infer<typeof digestSchema>, fallback: string, max: number) {
  const summary = MemoryShared.brief(input.summary.trim() || fallback, max)
  const topic = MemoryShared.brief(input.topic.trim() || summary.split(/[.;:]/)[0] || summary, 80)
  if (MemoryDigest.empty({ topic, summary })) return { topic: "", summary: "" }
  return { topic, summary }
}

export function typedCapture(input: { reason?: CaptureReason; signal?: boolean; interval: boolean }) {
  const completed = !input.reason || input.reason === "completed"
  const fresh = !input.interval
  return {
    call: completed && fresh,
    work: completed && fresh,
  }
}

export function capturePlan(input: {
  reason?: CaptureReason
  summary: string
  echo: boolean
  durable: boolean
  priorTime: number
  now: number
  minIntervalMs: number
  lastConsolidatedAt: number | null | undefined
  bypassInterval?: boolean
  autoConsolidate: boolean
}) {
  const completed = !input.reason || input.reason === "completed"
  const session = input.autoConsolidate && completed && !input.echo && Boolean(input.summary)
  const digestDue =
    session &&
    (!input.priorTime ||
      !Number.isFinite(input.priorTime) ||
      input.now - input.priorTime >= input.minIntervalMs ||
      input.durable)
  const interval = Boolean(
    !input.bypassInterval &&
      input.lastConsolidatedAt &&
      input.now - input.lastConsolidatedAt < input.minIntervalMs &&
      !input.durable,
  )
  const typed = typedCapture({ reason: input.reason, interval })
  const typedCall = input.autoConsolidate && typed.call && session
  const typedWork = input.autoConsolidate && typed.work && session
  const skipReason =
    !digestDue && !typedWork
      ? input.echo && completed
        ? "memory_echo"
        : interval && (input.reason === undefined || input.reason === "completed")
          ? "interval"
          : "no_work"
      : undefined
  return {
    completed,
    session,
    digestDue,
    interval,
    typedCall,
    typedWork,
    skipReason,
    idleFlush: skipReason === "interval" && session,
  }
}

export function usage(input: unknown) {
  if (!input || typeof input !== "object") return 0
  const value = input as { totalTokens?: unknown; inputTokens?: unknown; outputTokens?: unknown }
  const num = (item: unknown) => {
    if (typeof item === "number" && Number.isFinite(item)) return item
    if (typeof item !== "object" || item === null) return 0
    const nested = item as { total?: unknown }
    return typeof nested.total === "number" && Number.isFinite(nested.total) ? nested.total : 0
  }
  const total = num(value.totalTokens)
  if (total > 0) return total
  return num(value.inputTokens) + num(value.outputTokens)
}

function detail(input: unknown) {
  if (input === undefined || input === null) return ""
  if (typeof input === "string") return input
  if (input instanceof Error) return input.message
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

export function errorReason(err: unknown) {
  if (!(err instanceof Error)) return MemoryShared.brief(String(err), 500)
  const value = err as Error & {
    cause?: unknown
    data?: unknown
    responseBody?: unknown
    response?: unknown
    status?: unknown
    statusCode?: unknown
  }
  const parts = [
    err.message,
    value.status === undefined ? "" : `status=${detail(value.status)}`,
    value.statusCode === undefined ? "" : `statusCode=${detail(value.statusCode)}`,
    value.data === undefined ? "" : `data=${detail(value.data)}`,
    value.responseBody === undefined ? "" : `body=${detail(value.responseBody)}`,
    value.response === undefined ? "" : `response=${detail(value.response)}`,
    value.cause === undefined ? "" : `cause=${detail(value.cause)}`,
  ].filter(Boolean)
  return MemoryShared.brief(MemoryRedact.text(parts.join(" ")), 500)
}

export function guardReason(input: string) {
  const value = input.toLowerCase()
  if (/\b(429|rate[_ -]?limit|too many requests)\b/.test(value)) return "rate_limit_guard"
  if (/\b(insufficient[_ -]?quota|quota exceeded|exceeded your quota|billing|credits?|credit balance)\b/.test(value))
    return "quota_guard"
  return undefined
}

export function skipped(input: { sessionID: string; reason: string }): MemoryFiles.Decision {
  return {
    kind: "typed",
    trigger: "turn-close",
    sessionID: input.sessionID,
    result: "skipped",
    llm: false,
    parsed: false,
    fallback: false,
    reason: input.reason,
    tokens: 0,
    operationCount: 0,
    skippedCount: 1,
    summary: `memory capture skipped: ${input.reason}`,
  }
}

export function auditOps(ops: MemoryOperations.Op[]) {
  return MemoryShared.audit(ops)
}

function tokens(input: string) {
  return MemoryShared.terms(input)
}

function duplicate(text: string | undefined, items: CaptureSourceItem[]) {
  if (!text) return
  const query = tokens(text)
  if (query.length === 0) return
  // Majority overlap required: a few shared generic terms must not confirm a duplicate.
  const needed = Math.max(Math.min(3, query.length), Math.ceil(query.length / 2))
  const hits = items
    .map((item) => {
      const hay = tokens(item.text)
      const found = query.filter((term) => hay.includes(term)).length
      return { item, found }
    })
    .filter((item) => item.found >= needed)
    .sort((a, b) => b.found - a.found)
  return hits.at(0)?.item.id
}

/** Model-claimed duplicates are verified against stored entries; unconfirmed claims are rescued as ops instead of lost. */
export function verifySkips(input: { skipped: CaptureSkip[]; items: CaptureSourceItem[] }) {
  const skipped: CaptureSkip[] = []
  const rescued: MemoryOperations.Op[] = []
  for (const item of input.skipped) {
    if (item.reason !== "duplicate" || !item.text) {
      skipped.push(item)
      continue
    }
    const source = duplicate(item.text, input.items)
    if (source) {
      skipped.push({ ...item, duplicateOf: item.duplicateOf ?? source })
      continue
    }
    skipped.push({ reason: "unsupported", text: item.text })
  }
  return { skipped, rescued }
}

export function duplicateOps(input: { ops: MemoryOperations.Op[]; skipped: CaptureSkip[]; items: CaptureSourceItem[] }) {
  const skipped = [...input.skipped]
  const ops = input.ops.filter((item) => {
    if (item.action !== "add") return true
    const rejected = MemoryOperations.reject(item)
    if (rejected) {
      skipped.push(rejected)
      return false
    }
    const source = duplicate(`${item.key} ${item.text}`, input.items)
    if (!source) return true
    skipped.push({ reason: "duplicate", text: item.text, duplicateOf: source })
    return false
  })
  return { ops, skipped }
}

function attr(input: string | undefined) {
  if (!input) return ""
  return input
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^A-Za-z0-9_.:/=-]/g, "")
    .slice(0, 160)
}

export function skipLine(input: CaptureSkip[]) {
  const item = input.at(0)
  if (!item) return ""
  const reason = attr(item.reason)
  const source = attr(item.duplicateOf)
  return [reason ? `reason=${reason}` : "", source ? `duplicateOf=${source}` : ""].filter(Boolean).join(" ")
}

export function notice(input: {
  count: number
  ops: MemoryOperations.Op[]
  skipped: CaptureSkip[]
  tokens: number
}): CaptureDetail | undefined {
  const references = MemoryShared.refs(input.ops)
  if (input.count > 0) {
    return {
      type: "saved",
      message: `Memory saved · ${references.join(", ") || `${input.count} ops`}`,
      tokens: input.tokens,
      operationCount: input.count,
      sources: references,
      files: MemoryShared.files(input.ops),
    }
  }
  return {
    type: "skipped",
    message: "Memory checked · no new items",
    tokens: input.tokens,
    operationCount: 0,
    skippedCount: input.skipped.length,
    sources: references,
    files: MemoryShared.files(input.ops),
  }
}

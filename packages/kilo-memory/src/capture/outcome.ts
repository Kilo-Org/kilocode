import { MemoryOperations } from "./operations"
import { MemoryRedact } from "./redact"
import { MemoryShared } from "../recall/shared"
import { TRANSIENT } from "../schema"
import type { MemoryFiles } from "../storage/store"
import type { CaptureSkip } from "./parse"

export { TRANSIENT }

export type CaptureSourceItem = {
  id: string
  text: string
  file?: MemoryOperations.Add["file"]
  section?: string
  key?: string
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

const RATE_TEXT = /\b(429|rate[_ -]?limit|too many requests)\b/
const QUOTA_TEXT = /\b(insufficient[_ -]?quota|quota exceeded|exceeded your quota|billing|credits?|credit balance)\b/
const TIMEOUT_TEXT =
  /\b(timeouterror|etimedout|deadline[ _-]?exceeded|timed out|(connect|headers|body|gateway)[ _-]?time[ -]?out)\b|^timeout$/
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])

/** Structural timeout detection over an error's name/status/code, its message text, and its nested
 * cause/errors chains (cycle-safe). Message matching is limited to `message` — never the serialized
 * body/data blobs — so response payloads that merely mention "timeout" cannot classify as transient. */
function timedOut(item: unknown, seen = new WeakSet<object>()): boolean {
  if (!item || typeof item !== "object" || seen.has(item)) return false
  seen.add(item)
  const err = item as {
    name?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
    message?: unknown
    cause?: unknown
    errors?: unknown
  }
  if (err.name === "TimeoutError") return true
  if (err.status === 504 || err.statusCode === 504) return true
  if (typeof err.code === "string" && TIMEOUT_CODES.has(err.code)) return true
  if (typeof err.message === "string" && TIMEOUT_TEXT.test(err.message.toLowerCase())) return true
  if (timedOut(err.cause, seen)) return true
  return Array.isArray(err.errors) && err.errors.some((entry) => timedOut(entry, seen))
}

function rateGuarded(item: unknown, seen = new WeakSet<object>()): boolean {
  if (!item || typeof item !== "object" || seen.has(item)) return false
  seen.add(item)
  const err = item as {
    status?: unknown
    statusCode?: unknown
    message?: unknown
    cause?: unknown
    errors?: unknown
  }
  if (err.status === 429 || err.statusCode === 429) return true
  if (typeof err.message === "string" && RATE_TEXT.test(err.message.toLowerCase())) return true
  if (rateGuarded(err.cause, seen)) return true
  return Array.isArray(err.errors) && err.errors.some((entry) => rateGuarded(entry, seen))
}

function quotaGuarded(item: unknown, seen = new WeakSet<object>()): boolean {
  if (!item || typeof item !== "object" || seen.has(item)) return false
  seen.add(item)
  const err = item as {
    message?: unknown
    cause?: unknown
    errors?: unknown
  }
  if (typeof err.message === "string" && QUOTA_TEXT.test(err.message.toLowerCase())) return true
  if (quotaGuarded(err.cause, seen)) return true
  return Array.isArray(err.errors) && err.errors.some((entry) => quotaGuarded(entry, seen))
}

export function guardReason(input: unknown) {
  const value = (typeof input === "string" ? input : errorReason(input)).toLowerCase()
  if (typeof input === "string" ? RATE_TEXT.test(value) : rateGuarded(input) || RATE_TEXT.test(value))
    return "rate_limit_guard"
  if (typeof input === "string" ? QUOTA_TEXT.test(value) : quotaGuarded(input) || QUOTA_TEXT.test(value))
    return "quota_guard"
  if (typeof input === "string" ? TIMEOUT_TEXT.test(value) : timedOut(input)) return TRANSIENT
  return undefined
}

/** @deprecated Memory audit persistence was removed. */
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

/** @deprecated Memory audit persistence was removed. */
export function auditOps(ops: MemoryOperations.Op[]) {
  return MemoryShared.audit(ops)
}

function tokens(input: string) {
  return MemoryShared.terms(input)
}

function duplicate(input: {
  text: string | undefined
  items: CaptureSourceItem[]
  file?: MemoryOperations.Add["file"]
  section?: string
}) {
  const text = input.text
  if (!text) return
  const query = tokens(text)
  if (query.length === 0) return
  // Majority overlap required: a few shared generic terms must not confirm a duplicate.
  const needed = Math.max(Math.min(3, query.length), Math.ceil(query.length / 2))
  const hits = input.items
    .filter((item) => !input.file || !item.file || item.file === input.file)
    .filter((item) => !input.section || !item.section || item.section === input.section)
    .map((item) => {
      const hay = tokens(item.text)
      const found = query.filter((term) => hay.includes(term)).length
      return { item, found }
    })
    .filter((item) => item.found >= needed)
    .sort((a, b) => b.found - a.found)
  return hits.at(0)?.item.id
}

/** Model-claimed duplicates are verified against stored entries; unconfirmed claims are downgraded to
 * "unsupported" so they read as advisory rather than confirmed against a real entry. */
export function verifySkips(input: { skipped: CaptureSkip[]; items: CaptureSourceItem[] }) {
  const skipped: CaptureSkip[] = []
  for (const item of input.skipped) {
    if (item.reason !== "duplicate" || !item.text) {
      skipped.push(item)
      continue
    }
    // A model-claimed duplicate is only confirmable when it names the exact scope (file + section).
    // Any missing scope field would let fuzzy text matching confirm against unrelated memory, so
    // downgrade partially-scoped or unscoped claims to advisory instead.
    const scoped = item.file !== undefined && item.section !== undefined
    const source = scoped
      ? duplicate({ text: item.text, items: input.items, file: item.file, section: item.section })
      : undefined
    if (source) {
      skipped.push({ ...item, duplicateOf: item.duplicateOf ?? source })
      continue
    }
    skipped.push({ reason: "unsupported", text: item.text })
  }
  return { skipped }
}

export function duplicateOps(input: {
  ops: MemoryOperations.Op[]
  skipped: CaptureSkip[]
  items: CaptureSourceItem[]
}) {
  const skipped = [...input.skipped]
  const existing = new Set(input.items.map((item) => item.id))
  const ops = input.ops.filter((item) => {
    if (item.action !== "add") return true
    const rejected = MemoryOperations.reject(item)
    if (rejected) {
      skipped.push(rejected)
      return false
    }
    // Exact-key upsert: same file/section/key as an existing entry is an update, not a duplicate —
    // route it to apply (which updates the line in place) instead of dropping it here.
    if (item.file && existing.has(MemoryOperations.id(item))) return true
    const source = duplicate({
      text: `${item.key} ${item.text}`,
      items: input.items,
      file: item.file,
      section: item.section,
    })
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
  const ops = input.ops.filter((item) => item.action !== "add" || !MemoryOperations.secret(item))
  const references = MemoryShared.refs(ops)
  if (input.count > 0) {
    return {
      type: "saved",
      message: `Memory saved · ${references.join(", ") || `${input.count} ops`}`,
      tokens: input.tokens,
      operationCount: input.count,
      sources: references,
      files: MemoryShared.files(ops),
    }
  }
  return {
    type: "skipped",
    message: "Memory checked · no new items",
    tokens: input.tokens,
    operationCount: 0,
    skippedCount: input.skipped.length,
    sources: references,
    files: MemoryShared.files(ops),
  }
}

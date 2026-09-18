// Pure cron engine for the wakeup service. No Effect, no I/O, no dependencies:
// the resolver in schema.ts is the style reference, but this module stays plain
// so it can be unit-tested and reused without a runtime.

/**
 * Cron is minute-granular, so the smallest interval a schedule can express is
 * one minute. A schedule never fires twice inside this window.
 */
export const MIN_INTERVAL_MS = 60_000

/** Upper bound on the deterministic fire-time jitter applied to a schedule. */
export const JITTER_MS = 15_000

/** The five fields, in order, with their inclusive value bounds. */
const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
] as const

type Field = (typeof FIELDS)[number]

type Compiled = { sets: Set<number>[]; star: boolean[] }

const INT = /^\d+$/

/** Zero and seven both mean Sunday, so fold seven into zero for matching. */
function fold(value: number, field: Field): number {
  return field.name === "day-of-week" && value === 7 ? 0 : value
}

function parseToken(token: string, field: Field): Set<number> | string {
  if (token === "") return `Unknown token "${token}" in ${field.name}`
  const parts = token.split("/")
  if (parts.length > 2) return `Unknown token "${token}" in ${field.name}`
  const stepped = parts.length === 2
  if (stepped && !INT.test(parts[1])) return `Unknown token "${token}" in ${field.name}`
  const step = stepped ? Number(parts[1]) : 1
  if (step === 0) return `Step 0 is not allowed in ${field.name}`

  const body = parts[0]
  let start: number
  let end: number
  if (body === "*") {
    start = field.min
    end = field.max
  } else if (body.includes("-")) {
    const bounds = body.split("-")
    if (bounds.length !== 2 || !INT.test(bounds[0]) || !INT.test(bounds[1])) {
      return `Unknown token "${token}" in ${field.name}`
    }
    start = Number(bounds[0])
    end = Number(bounds[1])
    if (start > end) return `Reversed range ${body} in ${field.name}`
  } else {
    if (!INT.test(body)) return `Unknown token "${token}" in ${field.name}`
    start = Number(body)
    end = stepped ? field.max : start
  }

  if (start < field.min || start > field.max) {
    return `${field.name} value ${start} out of range (${field.min}-${field.max})`
  }
  if (end < field.min || end > field.max) {
    return `${field.name} value ${end} out of range (${field.min}-${field.max})`
  }

  const values = new Set<number>()
  for (let value = start; value <= end; value += step) values.add(fold(value, field))
  return values
}

function parseField(spec: string, field: Field): Set<number> | string {
  const values = new Set<number>()
  for (const token of spec.split(",")) {
    const parsed = parseToken(token, field)
    if (typeof parsed === "string") return parsed
    for (const value of parsed) values.add(value)
  }
  return values
}

function compile(expr: string): Compiled | string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return `Expected 5 fields, got ${parts.length}`
  const sets: Set<number>[] = []
  const star: boolean[] = []
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(parts[i], FIELDS[i])
    if (typeof parsed === "string") return parsed
    sets.push(parsed)
    star.push(parts[i] === "*")
  }
  return { sets, star }
}

function matches(cron: Compiled, date: Date): boolean {
  if (!cron.sets[0].has(date.getMinutes())) return false
  if (!cron.sets[1].has(date.getHours())) return false
  if (!cron.sets[3].has(date.getMonth() + 1)) return false
  const dom = cron.sets[2].has(date.getDate())
  const dow = cron.sets[4].has(date.getDay())
  if (cron.star[2] && cron.star[4]) return true
  if (cron.star[2]) return dow
  if (cron.star[4]) return dom
  // Vixie cron: two restricted day fields combine with OR.
  return dom || dow
}

/**
 * `undefined` when the expression is a valid 5-field cron, else a short
 * human-readable reason the expression was rejected.
 */
export function validate(expr: string): string | undefined {
  const compiled = compile(expr)
  return typeof compiled === "string" ? compiled : undefined
}

/**
 * The next epoch-ms strictly after `from` that the expression matches, at
 * minute granularity. Walks minute by minute in host-local time, so the walk
 * observes local wall-clock dates and DST transitions. Throws on an invalid
 * expression and when nothing matches within 366 days.
 */
export function next(expr: string, from: number): number {
  const compiled = compile(expr)
  if (typeof compiled === "string") throw new Error(compiled)
  const first = Math.floor(from / MIN_INTERVAL_MS) * MIN_INTERVAL_MS + MIN_INTERVAL_MS
  const limit = first + 366 * 24 * 60 * MIN_INTERVAL_MS
  for (let time = first; time <= limit; time += MIN_INTERVAL_MS) {
    if (matches(compiled, new Date(time))) return time
  }
  throw new Error(`No match within 366 days for: ${expr}`)
}

/**
 * A stable offset in `[0, JITTER_MS)` derived from `id` only, so the same
 * schedule always fires with the same jitter. FNV-1a keeps it cheap and spread
 * across ids.
 */
export function jitter(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % JITTER_MS
}

/** True when `input` is five whitespace-separated tokens. */
export function isExpression(input: string): boolean {
  return input.trim().split(/\s+/).length === 5
}

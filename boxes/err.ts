/**
 * err.ts — Universal error message extraction
 * Zero deps.
 *
 * msg(new Error("fail")) → "fail"
 * msg({ message: "bad" }) → "bad"
 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

export function msg(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (isObj(e)) {
    if (typeof e.message === "string" && e.message) return e.message
    if (isObj(e.data) && typeof e.data.message === "string") return e.data.message
  }
  const s = String(e)
  return s && s !== "[object Object]" ? s : "unknown error"
}

export function fmt(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`
  if (typeof e === "object" && e !== null) { try { return JSON.stringify(e, null, 2) } catch {} }
  return String(e)
}

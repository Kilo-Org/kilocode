function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

export function merge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(source)) {
    if (isObj(v) && isObj(out[k])) {
      out[k] = merge(out[k] as Record<string, unknown>, v as Partial<Record<string, unknown>>)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export function stripNulls<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    if (isObj(v)) out[k] = stripNulls(v as Record<string, unknown>)
    else out[k] = v
  }
  return out as T
}

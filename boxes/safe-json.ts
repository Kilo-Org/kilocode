/**
 * safe-json.ts — Circular-reference-safe JSON.stringify
 * Ported from gemini-cli (Apache-2.0)
 * Deps: none
 */

export function safeJsonStringify(obj: unknown, space?: string | number): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value as unknown
  }, space)
}

export function safeLiteralReplace(str: string, old: string, rep: string): string {
  if (old === "" || !str.includes(old)) return str
  if (!rep.includes("$")) return str.replaceAll(old, rep)
  return str.replaceAll(old, rep.replaceAll("$", "$$$$"))
}

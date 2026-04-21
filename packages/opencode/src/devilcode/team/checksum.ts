import crypto from "crypto"
import type { CanonicalTeamConfig } from "./config"

export function stableStringify(value: unknown): string {
  if (value === undefined) return ""
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v) ?? "null").join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}"
}

export function computeTeamChecksum(config: CanonicalTeamConfig): string {
  return crypto.createHash("sha256").update(stableStringify(config), "utf-8").digest("hex")
}

export function verifyTeamChecksum(config: CanonicalTeamConfig, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false
  try {
    const computed = computeTeamChecksum(config)
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

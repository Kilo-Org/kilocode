/**
 * uid.ts — Monotonic sortable ID generator with prefix + base62
 * Deps: Node crypto
 *
 * ascend("evt") → "evt_a1b2c3d4e5f6..."
 * descend("ses") → "ses_~encoded..."
 * ts(uid) → 1700000000000
 */
import { randomBytes } from "crypto"

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastT = 0
let seq = 0

function b62(n: number): string {
  let s = ""
  const b = randomBytes(n)
  for (let i = 0; i < n; i++) s += B62[b[i] % 62]
  return s
}

export function ascend(pre: string, given?: string): string {
  if (given) { if (!given.startsWith(pre + "_")) throw new Error(`bad prefix: ${given}`); return given }
  return mk(pre, "asc")
}

export function descend(pre: string, given?: string): string {
  if (given) { if (!given.startsWith(pre + "_")) throw new Error(`bad prefix: ${given}`); return given }
  return mk(pre, "desc")
}

function mk(pre: string, dir: "asc" | "desc", ts?: number): string {
  const now = ts ?? Date.now()
  if (now !== lastT) { lastT = now; seq = 0 }
  seq++
  let n = BigInt(now) * BigInt(0x1000) + BigInt(seq)
  if (dir === "desc") n = ~n
  const buf = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) buf[i] = Number((n >> BigInt(40 - 8 * i)) & BigInt(0xff))
  return pre + "_" + buf.toString("hex") + b62(14)
}

export function ts(id: string): number {
  const p = id.indexOf("_")
  const hex = id.slice(p + 1, p + 13)
  return Number(BigInt("0x" + hex) / BigInt(0x1000))
}

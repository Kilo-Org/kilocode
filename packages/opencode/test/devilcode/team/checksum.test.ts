import { describe, it, expect } from "bun:test"
import {
  stableStringify,
  computeTeamChecksum,
  verifyTeamChecksum,
} from "@/devilcode/team/checksum"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"

function shuffleKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const keys = Object.keys(obj)
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[keys[i], keys[j]] = [keys[j] as string, keys[i] as string]
  }
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = obj[k as keyof T]
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = shuffleKeys(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

describe("stableStringify", () => {
  it("elides undefined values", () => {
    expect(stableStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}')
  })

  it("produces identical output across shuffled key orders", () => {
    const base = { a: 1, b: { x: 10, y: 20 }, c: [1, 2, 3] }
    const base2 = { c: [1, 2, 3], a: 1, b: { y: 20, x: 10 } }
    expect(stableStringify(base)).toBe(stableStringify(base2))
  })

  it("handles nulls and primitives", () => {
    expect(stableStringify(null)).toBe("null")
    expect(stableStringify(42)).toBe("42")
    expect(stableStringify("hi")).toBe('"hi"')
    expect(stableStringify(true)).toBe("true")
  })

  it("arrays preserve order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]")
  })
})

describe("computeTeamChecksum", () => {
  const template = loadQuickstartTemplates()["solo-enhanced"].team as CanonicalTeamConfig

  it("returns 64-char lowercase hex", () => {
    const cs = computeTeamChecksum(template)
    expect(cs).toMatch(/^[a-f0-9]{64}$/)
  })

  it("is key-order-independent across 10 shuffles", () => {
    const baseline = computeTeamChecksum(template)
    for (let i = 0; i < 10; i++) {
      const shuffled = shuffleKeys(template as unknown as Record<string, unknown>) as unknown as CanonicalTeamConfig
      expect(computeTeamChecksum(shuffled)).toBe(baseline)
    }
  })

  it("changes when content changes", () => {
    const base = computeTeamChecksum(template)
    const mutated = JSON.parse(JSON.stringify(template)) as CanonicalTeamConfig
    const firstKey = Object.keys(mutated.roles)[0]!
    mutated.roles[firstKey]!.displayName = mutated.roles[firstKey]!.displayName + "-changed"
    expect(computeTeamChecksum(mutated)).not.toBe(base)
  })
})

describe("verifyTeamChecksum", () => {
  const template = loadQuickstartTemplates()["full-stack-team"].team as CanonicalTeamConfig

  it("returns true on match", () => {
    const cs = computeTeamChecksum(template)
    expect(verifyTeamChecksum(template, cs)).toBe(true)
  })

  it("returns false on mismatch", () => {
    const wrong = "0".repeat(64)
    expect(verifyTeamChecksum(template, wrong)).toBe(false)
  })

  it("rejects non-hex expected value (regex guard)", () => {
    expect(verifyTeamChecksum(template, "not-hex")).toBe(false)
    expect(verifyTeamChecksum(template, "ABCDEF")).toBe(false) // uppercase
    expect(verifyTeamChecksum(template, "a".repeat(63))).toBe(false) // too short
  })
})

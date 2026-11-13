import { describe, expect, test } from "bun:test"
import {
  forbiddenDirection,
  HIGHER_LAYERS,
  importSpecifiers,
  ratchet,
} from "../../../../script/kilocode/architecture-rules"

describe("forbiddenDirection", () => {
  test("rejects the internal alias", () => {
    expect(forbiddenDirection("@/session", HIGHER_LAYERS)).toBe("internal alias (@/)")
  })

  test("rejects higher layers", () => {
    expect(forbiddenDirection("@opencode/server", HIGHER_LAYERS)).toBe("higher layer package")
    expect(forbiddenDirection("@opencode/server/api", HIGHER_LAYERS)).toBe("higher layer package")
  })

  test("allows packages below the checked layer", () => {
    expect(forbiddenDirection("@opencode/schema", HIGHER_LAYERS)).toBeNull()
    expect(forbiddenDirection("@opencode/util", HIGHER_LAYERS)).toBeNull()
  })

  test("rejects Kilo packages, including the Kilo UI package", () => {
    expect(forbiddenDirection("@kilocode/kilo-ui", HIGHER_LAYERS)).toBe("Kilo package")
    expect(forbiddenDirection("@opencode-ai/ui", HIGHER_LAYERS)).toBe("Kilo package")
    expect(forbiddenDirection("@opencode-ai/ui/components", HIGHER_LAYERS)).toBe("Kilo package")
  })

  test("allows the external pty package", () => {
    expect(forbiddenDirection("@opencode-ai/pty", HIGHER_LAYERS)).toBeNull()
  })
})

describe("importSpecifiers", () => {
  test("collects static, side-effect and dynamic imports in source order", () => {
    const text = [
      'import { x } from "@opencode/core"',
      'import "@opencode/server/register"',
      'await import("@opencode/client")',
    ].join("\n")
    expect(importSpecifiers(text)).toEqual(["@opencode/core", "@opencode/server/register", "@opencode/client"])
  })
})

describe("ratchet", () => {
  const messages = {
    unclassified: (count: number) => `unclassified ${count}`,
    drift: (file: string, expected: number, count: number) => `drift ${file} ${expected} ${count}`,
    stale: (file: string) => `stale ${file}`,
  }

  test("returns a violation for a new site", () => {
    expect(ratchet("rule", new Map([["a.ts", 2]]), {}, messages)).toEqual([
      { file: "a.ts", rule: "rule", message: "unclassified 2" },
    ])
  })

  test("returns drift and stale violations", () => {
    const allowed = { "a.ts": { count: 1, owner: "x", reason: "y" } }
    expect(ratchet("rule", new Map([["a.ts", 2]]), allowed, messages)).toEqual([
      { file: "a.ts", rule: "rule", message: "drift a.ts 1 2" },
    ])
    expect(ratchet("rule", new Map(), allowed, messages)).toEqual([
      { file: "a.ts", rule: "rule", message: "stale a.ts" },
    ])
  })

  test("returns nothing for an allowed exact count", () => {
    const allowed = { "a.ts": { count: 1, owner: "x", reason: "y" } }
    expect(ratchet("rule", new Map([["a.ts", 1]]), allowed, messages)).toEqual([])
  })
})

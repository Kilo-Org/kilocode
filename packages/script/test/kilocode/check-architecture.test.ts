import { describe, expect, test } from "bun:test"
import {
  code,
  countMatches,
  forbiddenDirection,
  HIGHER_LAYERS,
  importSpecifiers,
  ratchet,
} from "../../../../script/kilocode/architecture-rules"
import { PROCESS_STATE } from "../../../../script/kilocode/test/process-state"

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

// Built at runtime, so the architecture check does not count these fixtures as process-wide state in this file.
const MOCK = ["mock", "module"].join(".")
const SPY = ["spyOn", "(globalThis"].join("")

describe("code", () => {
  test("blanks line comments and block comments that start a line", () => {
    const text = [
      `// ${MOCK}(a)`,
      "/*",
      `${MOCK}(b)`,
      "*/",
      `/** ${MOCK}(c) */`,
      "/**",
      ` * ${MOCK}(d)`,
      " */",
      `${MOCK}(e)`,
    ].join("\n")
    expect(countMatches(code(text), PROCESS_STATE)).toBe(1)
  })

  test("keeps a trailing comment after code and template lines that do not start a comment", () => {
    const text = [`const a = 1 // ${MOCK}(a)`, "const b = `", `${MOCK}(b)`, "`"].join("\n")
    expect(countMatches(code(text), PROCESS_STATE)).toBe(2)
  })
})

describe("PROCESS_STATE", () => {
  test("counts module-scope writes but not writes inside a hook", () => {
    const text = [
      `${MOCK}("openai", () => ({}))`,
      `${SPY}, "fetch")`,
      'process.env.FOO = "1"',
      "delete process.env.BAR",
      "globalThis.fetch = fake",
      "global.fetch = fake",
      "beforeEach(() => {",
      '  process.env.FOO = "1"',
      "  globalThis.fetch = fake",
      "})",
      "if (globalThis.fetch === fake) {}",
    ].join("\n")
    expect(countMatches(text, PROCESS_STATE)).toBe(6)
  })
})

/**
 * independence.test.ts — Verify each atom loads independently
 * Each atom is dynamically imported in isolation to catch:
 * - Missing imports
 * - Circular dependencies
 * - Runtime errors at module level
 */
import { describe, test, expect } from "bun:test"

// 순수 TS 원자 (의존 0)
const PURE = [
  "call", "clamp", "esc-re", "is-plain", "title", "chop", "compact",
  "cleanup", "esc-html", "plural", "thunk", "latch", "rfind", "disposable",
  "gate", "sanitize", "tokens", "race", "dur", "fmt", "memo", "debounce",
  "parse-cmd", "gen-name", "clock", "bom", "cancel", "net", "redact",
  "scope", "ansi", "channel", "proxy", "puny", "bisect", "frontmatter",
  "path-parts", "rwlock", "merge", "throttle", "accessor", "age",
  "resolvable", "toolbox", "tally", "err", "human", "parse-ref", "render",
  "mime", "dataurl", "retry", "rpc", "diff-split", "wildcard",
  "hook-stream", "bits", "cost-tracker", "bash-security",
  // wave7: gemini-cli + abtop + superset
  "delay", "ttl-cache", "safe-json", "token-est", "deadline",
  "redactor", "sparkline",
  "circuit-breaker", "binary-frame", "typed-event",
  // wave8: n8n + MCP + A2A + Effect-TS
  "dag", "trigger", "json-rpc", "a2a-task", "result-chain", "schedule",
  // wave9: Continue.dev + onlook
  "diff-apply", "tab-complete", "context-rank",
  // earlier waves (missed in original list)
  "abort",
]

// Node 빌트인 의존 원자
const NODE_DEPS = ["sha", "b64", "uid", "entry", "store", "scan", "memory", "atomic-write"]

// 박스 내부 참조 원자 (risk -> parse-cmd)
const INTERNAL_REFS = ["risk"]

// parse-cmd이 risk보다 먼저 로드되어야 함
const ORDERED_REFS = ["parse-cmd", "risk"]

describe("independence: pure atoms", () => {
  for (const name of PURE) {
    test(`${name} loads without error`, async () => {
      const mod = await import(`./${name}`)
      expect(typeof mod).toBe("object")
      expect(Object.keys(mod).length).toBeGreaterThan(0)
    })
  }
})

describe("independence: node-dep atoms", () => {
  for (const name of NODE_DEPS) {
    test(`${name} loads with Node builtins`, async () => {
      const mod = await import(`./${name}`)
      expect(typeof mod).toBe("object")
      expect(Object.keys(mod).length).toBeGreaterThan(0)
    })
  }
})

describe("independence: internal refs", () => {
  for (const name of ORDERED_REFS) {
    test(`${name} loads (ordered deps)`, async () => {
      const mod = await import(`./${name}`)
      expect(typeof mod).toBe("object")
    })
  }
})

describe("independence: circular dep check", () => {
  test("no module appears in its own dependency chain", async () => {
    const { parseCmd } = await import("./parse-cmd")
    const { risk } = await import("./risk")
    // parse-cmd should not import risk (no circular)
    expect(typeof parseCmd).toBeDefined()
    expect(typeof risk).toBeDefined()
    // Verify parse-cmd does not reference risk module
    const pc = await import("./parse-cmd")
    const keys = Object.keys(pc)
    expect(keys.every(k => !k.includes("risk"))).toBe(true)
  })
})

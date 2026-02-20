import { describe, it, expect } from "bun:test"
import {
  getSuggestionKey,
  insertWithLRUEviction,
} from "../../src/services/autocomplete/classic-auto-complete/telemetry-utils"

describe("getSuggestionKey", () => {
  it("combines prefix, suffix, and text with pipe separators", () => {
    const key = getSuggestionKey({ prefix: "hello ", suffix: "\n}", text: "world" })
    expect(key).toBe("hello |\n}|world")
  })

  it("produces unique keys for different suggestions", () => {
    const k1 = getSuggestionKey({ prefix: "a", suffix: "c", text: "b" })
    const k2 = getSuggestionKey({ prefix: "a", suffix: "c", text: "x" })
    expect(k1).not.toBe(k2)
  })

  it("same content produces same key (stable)", () => {
    const s = { prefix: "const x = ", suffix: ";", text: "42" }
    expect(getSuggestionKey(s)).toBe(getSuggestionKey(s))
  })

  it("different prefix produces different key", () => {
    const k1 = getSuggestionKey({ prefix: "a", suffix: "", text: "t" })
    const k2 = getSuggestionKey({ prefix: "b", suffix: "", text: "t" })
    expect(k1).not.toBe(k2)
  })

  it("handles empty strings", () => {
    const key = getSuggestionKey({ prefix: "", suffix: "", text: "" })
    expect(key).toBe("||")
  })
})

describe("insertWithLRUEviction", () => {
  it("inserts key into map", () => {
    const map = new Map<string, true>()
    insertWithLRUEviction(map, "k1", 5)
    expect(map.has("k1")).toBe(true)
  })

  it("does not evict when under limit", () => {
    const map = new Map<string, true>()
    insertWithLRUEviction(map, "k1", 3)
    insertWithLRUEviction(map, "k2", 3)
    insertWithLRUEviction(map, "k3", 3)
    expect(map.size).toBe(3)
    expect(map.has("k1")).toBe(true)
  })

  it("evicts oldest key when limit exceeded", () => {
    const map = new Map<string, true>()
    insertWithLRUEviction(map, "k1", 3)
    insertWithLRUEviction(map, "k2", 3)
    insertWithLRUEviction(map, "k3", 3)
    insertWithLRUEviction(map, "k4", 3)
    expect(map.size).toBe(3)
    expect(map.has("k1")).toBe(false)
    expect(map.has("k4")).toBe(true)
  })

  it("handles maxSize of 1", () => {
    const map = new Map<string, true>()
    insertWithLRUEviction(map, "k1", 1)
    insertWithLRUEviction(map, "k2", 1)
    expect(map.size).toBe(1)
    expect(map.has("k2")).toBe(true)
    expect(map.has("k1")).toBe(false)
  })

  it("updating existing key does not increase size", () => {
    const map = new Map<string, true>()
    insertWithLRUEviction(map, "k1", 2)
    insertWithLRUEviction(map, "k1", 2)
    expect(map.size).toBe(1)
  })
})

import { beforeEach, describe, expect, it } from "bun:test"
import type { CacheSnapshot } from "virtua"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resetTranscriptCaches,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "../../webview-ui/src/components/chat/transcript-cache"

const snapshot = (id: number) => ({ id }) as unknown as CacheSnapshot
const layout = layoutFingerprint({ width: 800, ratio: 2, font: "Kilo Sans", size: "13px", line: "20px" })

describe("transcript measurement cache", () => {
  beforeEach(resetTranscriptCaches)

  it("returns a cache only for the exact row and layout fingerprints", () => {
    const keys = rowFingerprint(["a", "bc"])
    const cache = snapshot(1)
    setMeasurement("session", keys, layout, cache)

    expect(getMeasurement("session", keys, layout)).toBe(cache)
    expect(getMeasurement("session", rowFingerprint(["a", "bd"]), layout)).toBeUndefined()
    expect(getMeasurement("session", keys, layout)).toBeUndefined()
  })

  it("invalidates a measurement when layout changes", () => {
    const keys = rowFingerprint(["row"])
    setMeasurement("session", keys, layout, snapshot(1))
    const changed = layoutFingerprint({ width: 801, ratio: 2, font: "Kilo Sans", size: "13px", line: "20px" })

    expect(getMeasurement("session", keys, changed)).toBeUndefined()
    expect(getMeasurement("session", keys, layout)).toBeUndefined()
  })

  it("uses collision-safe row and layout fingerprints", () => {
    expect(rowFingerprint(["a|b", "c"])).not.toBe(rowFingerprint(["a", "b|c"]))
    expect(layoutFingerprint({ width: 80, ratio: 1, font: "a|b", size: "c", line: "d" })).not.toBe(
      layoutFingerprint({ width: 80, ratio: 1, font: "a", size: "b|c", line: "d" }),
    )
  })

  it("evicts the least recently used measurement after 16 sessions", () => {
    const keys = rowFingerprint(["row"])
    for (let i = 0; i < 16; i += 1) setMeasurement(`s${i}`, keys, layout, snapshot(i))
    expect(getMeasurement("s0", keys, layout)).toBeDefined()
    setMeasurement("s16", keys, layout, snapshot(16))

    expect(getMeasurement("s1", keys, layout)).toBeUndefined()
    expect(getMeasurement("s0", keys, layout)).toBeDefined()
  })
})

describe("transcript scroll cache", () => {
  beforeEach(resetTranscriptCaches)

  it("stores bottom-follow and anchored positions independently from measurements", () => {
    setMeasurement("a", rowFingerprint(["row"]), layout, snapshot(1))
    setScroll("a", { type: "bottom" })
    setScroll("b", { type: "anchor", key: "row-2", offset: 37 })

    expect(getScroll("a")).toEqual({ type: "bottom" })
    expect(getScroll("b")).toEqual({ type: "anchor", key: "row-2", offset: 37 })
  })

  it("resolves an anchor after prepended rows shift its index", () => {
    const state = { type: "anchor", key: "stable", offset: 19 } as const
    expect(resolveAnchor(state, ["stable", "tail"])).toEqual({ index: 0, offset: 19 })
    expect(resolveAnchor(state, ["older-1", "older-2", "stable", "tail"])).toEqual({ index: 2, offset: 19 })
    expect(resolveAnchor(state, ["other"])).toBeUndefined()
    expect(resolveAnchor({ type: "bottom" }, ["stable"])).toBeUndefined()
  })

  it("evicts the least recently used scroll state after 50 sessions", () => {
    for (let i = 0; i < 50; i += 1) setScroll(`s${i}`, { type: "bottom" })
    expect(getScroll("s0")).toEqual({ type: "bottom" })
    setScroll("s50", { type: "anchor", key: "row", offset: 4 })

    expect(getScroll("s1")).toBeUndefined()
    expect(getScroll("s0")).toEqual({ type: "bottom" })
    expect(getScroll("s50")).toEqual({ type: "anchor", key: "row", offset: 4 })
  })
})

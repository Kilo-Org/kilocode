// The effort carry and cycle rules of v1 `session-variant-store.ts`.
import { describe, expect, test } from "bun:test"
import { cycleVariant, preserveVariant } from "../webview-ui/src/v2/variant"

describe("preserveVariant", () => {
  test("keeps the exact effort when the new model has it", () => {
    expect(preserveVariant("high", ["low", "medium", "high"])).toBe("high")
  })

  test("keeps a non-effort id on an exact match", () => {
    expect(preserveVariant("instant", ["instant", "thinking"])).toBe("instant")
  })

  test("falls back to the nearest known effort", () => {
    expect(preserveVariant("low", ["none", "medium", "high"])).toBe("medium")
    expect(preserveVariant("xhigh", ["low", "medium", "high"])).toBe("high")
  })

  test("breaks a distance tie toward the higher effort", () => {
    expect(preserveVariant("low", ["none", "high"])).toBe("high")
  })

  test("returns undefined without a known effort or a candidate", () => {
    expect(preserveVariant(undefined, ["low", "high"])).toBeUndefined()
    expect(preserveVariant("high", [])).toBeUndefined()
    expect(preserveVariant("bogus", ["low", "high"])).toBeUndefined()
    expect(preserveVariant("high", ["instant", "thinking"])).toBeUndefined()
  })
})

describe("cycleVariant", () => {
  test("starts at the first effort and steps through the list", () => {
    expect(cycleVariant(undefined, ["low", "high"])).toBe("low")
    expect(cycleVariant("low", ["low", "high"])).toBe("high")
  })

  test("wraps from the last effort back to the default", () => {
    expect(cycleVariant("high", ["low", "high"])).toBeUndefined()
  })

  test("treats an unknown or default value as the start of the list", () => {
    expect(cycleVariant("default", ["low", "high"])).toBe("low")
    expect(cycleVariant("bogus", ["low", "high"])).toBe("low")
  })

  test("returns undefined without variants", () => {
    expect(cycleVariant(undefined, [])).toBeUndefined()
  })
})

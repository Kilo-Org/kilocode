import { beforeAll, describe, expect, test } from "bun:test"
import {
  CanonicalPosition,
  POSITION_CAPABILITY_MAP,
  POSITION_LIBRARY,
  getDefaultCanDelegate,
  validatePositionLibrary,
} from "@/devilcode/team/library"
import { CanonicalCapability } from "@/devilcode/team/capabilities"

describe("team library", () => {
  beforeAll(() => {
    // Validate all entries before any test runs
    validatePositionLibrary()
  })

  test("POSITION_LIBRARY has exactly 11 entries", () => {
    const keys = Object.keys(POSITION_LIBRARY)
    expect(keys.length).toBe(11)
    const sortedKeys = keys.slice().sort()
    const sortedOptions = (CanonicalPosition.options as readonly string[]).slice().sort()
    expect(sortedKeys).toEqual(sortedOptions)
  })

  test("each entry's id equals its key", () => {
    for (const [key, entry] of Object.entries(POSITION_LIBRARY)) {
      expect(entry.id as string).toBe(key)
    }
  })

  test("validatePositionLibrary() succeeds for all entries", () => {
    // Already called in beforeAll — verify it does not throw when called again
    expect(() => validatePositionLibrary()).not.toThrow()
  })

  test("every canonicalCapabilities array is non-empty and canonical", () => {
    const validCaps = new Set(CanonicalCapability.options)
    for (const [id, entry] of Object.entries(POSITION_LIBRARY)) {
      expect(entry.canonicalCapabilities.length, `${id} has empty canonicalCapabilities`).toBeGreaterThan(0)
      for (const cap of entry.canonicalCapabilities) {
        expect(validCaps.has(cap), `${id} has unknown capability "${cap}"`).toBe(true)
      }
    }
  })

  test("every primaryCapability is in canonicalCapabilities", () => {
    for (const [id, entry] of Object.entries(POSITION_LIBRARY)) {
      expect(
        entry.canonicalCapabilities.includes(entry.primaryCapability),
        `${id}: primaryCapability "${entry.primaryCapability}" not in canonicalCapabilities`,
      ).toBe(true)
    }
  })

  test("Coordinator carries planning AND retrospective", () => {
    const coordinator = POSITION_LIBRARY["coordinator"]
    expect(coordinator.canonicalCapabilities).toContain("planning")
    expect(coordinator.canonicalCapabilities).toContain("retrospective")
  })

  test("only Coordinator carries retrospective by default", () => {
    const entriesWithRetrospective = Object.entries(POSITION_LIBRARY).filter(([, entry]) =>
      entry.canonicalCapabilities.includes("retrospective"),
    )
    expect(entriesWithRetrospective.length).toBe(1)
    expect(entriesWithRetrospective[0][0]).toBe("coordinator")
  })

  test("POSITION_CAPABILITY_MAP maps every position and each value is a CanonicalCapability", () => {
    const validCaps = new Set(CanonicalCapability.options)
    for (const pos of CanonicalPosition.options) {
      expect(POSITION_CAPABILITY_MAP).toHaveProperty(pos)
      expect(validCaps.has(POSITION_CAPABILITY_MAP[pos])).toBe(true)
    }
  })

  test("defaultCanDelegate entries (non-coordinator) all exist in library", () => {
    const validPositions = new Set(CanonicalPosition.options)
    for (const [id, entry] of Object.entries(POSITION_LIBRARY)) {
      if (id === "coordinator") continue
      for (const delegatee of entry.defaultCanDelegate) {
        expect(
          validPositions.has(delegatee),
          `${id}: delegatee "${delegatee}" is not a valid CanonicalPosition`,
        ).toBe(true)
      }
    }
  })

  test("getDefaultCanDelegate('coordinator') returns 10 other positions", () => {
    const result = getDefaultCanDelegate("coordinator")
    expect(result.length).toBe(10)
    expect(result).not.toContain("coordinator")
    // Every returned position is a valid CanonicalPosition
    const validPositions = new Set(CanonicalPosition.options)
    for (const pos of result) {
      expect(validPositions.has(pos)).toBe(true)
    }
  })

  test("getDefaultCanDelegate('spec-writer') returns empty array", () => {
    const result = getDefaultCanDelegate("spec-writer")
    expect(result).toEqual([])
  })
})

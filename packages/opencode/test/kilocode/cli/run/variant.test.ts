import { describe, expect, test } from "bun:test"
import { preserveVariant, resolvePreservedVariant } from "@/kilocode/cli/cmd/run/variant"

describe("Kilo CLI variant preservation", () => {
  test("keeps exact variants across supported families", () => {
    expect(preserveVariant("high", ["low", "high"])).toBe("high")
    expect(preserveVariant("thinking", ["instant", "thinking"])).toBe("thinking")
    expect(preserveVariant("default", ["default", "thinking"])).toBe("default")
  })

  test("keeps an explicit CLI variant verbatim", () => {
    expect(resolvePreservedVariant("max", "high", ["low", "medium", "high"])).toBe("max")
    expect(resolvePreservedVariant("thinking", "high", ["low", "medium", "high"])).toBe("thinking")
  })

  test("falls back to the nearest supported reasoning effort", () => {
    expect(preserveVariant("max", ["high", "xhigh"])).toBe("xhigh")
    expect(preserveVariant("high", ["low", "medium"])).toBe("medium")
    expect(preserveVariant("max", ["none", "low"])).toBe("low")
  })

  test("does not cross binary or custom variant families", () => {
    expect(preserveVariant("thinking", ["low", "high"])).toBeUndefined()
    expect(preserveVariant("instant", ["low", "high"])).toBeUndefined()
    expect(preserveVariant("turbo", ["low", "high"])).toBeUndefined()
    expect(preserveVariant("high", ["instant", "thinking"])).toBeUndefined()
  })
})

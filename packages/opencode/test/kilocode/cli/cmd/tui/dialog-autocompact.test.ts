import { describe, expect, test } from "bun:test"
import {
  AUTOCOMPACT_PRESETS,
  currentOption,
  parsePercent,
  saveThreshold,
  thresholdLabel,
  thresholdOptions,
  thresholdPatch,
  type ThresholdSaveDeps,
} from "@/kilocode/cli/cmd/tui/component/dialog-autocompact"

describe("autocompact parsePercent", () => {
  test("parses plain and percent-suffixed input", () => {
    expect(parsePercent("80")).toBe(80)
    expect(parsePercent(" 72.5% ")).toBe(72.5)
    expect(parsePercent("95%")).toBe(95)
  })

  test("empty input disables the percentage trigger", () => {
    expect(parsePercent("")).toBeNull()
    expect(parsePercent("   ")).toBeNull()
  })

  test("non-numeric input is invalid", () => {
    expect(parsePercent("abc")).toBeUndefined()
    expect(parsePercent("1e999")).toBeUndefined()
    expect(parsePercent("%")).toBeUndefined()
  })

  test("clamps to the schema bounds [1, 100]", () => {
    expect(parsePercent("0")).toBe(1)
    expect(parsePercent("-5")).toBe(1)
    expect(parsePercent("150")).toBe(100)
  })
})

describe("autocompact thresholdPatch", () => {
  test("a number writes the threshold key", () => {
    expect(thresholdPatch(80)).toEqual({ set: { compaction: { threshold_percent: 80 } } })
  })

  test("null unsets only the threshold key so sibling compaction keys survive", () => {
    expect(thresholdPatch(null)).toEqual({ unset: [["compaction", "threshold_percent"]] })
  })

  test("the patch is stable, so a failed save can be retried unchanged", () => {
    expect(thresholdPatch(70)).toEqual(thresholdPatch(70))
    expect(thresholdPatch(null)).toEqual(thresholdPatch(null))
  })
})

describe("autocompact thresholdLabel", () => {
  test("formats a number as a percentage", () => {
    expect(thresholdLabel(80)).toBe("80%")
  })

  test("null and undefined mean the default trigger", () => {
    expect(thresholdLabel(null)).toBe("Only when full")
    expect(thresholdLabel(undefined)).toBe("Only when full")
  })
})

describe("autocompact currentOption", () => {
  test("a preset number returns itself", () => {
    expect(currentOption(80)).toBe(80)
    for (const preset of AUTOCOMPACT_PRESETS) {
      expect(currentOption(preset)).toBe(preset)
    }
  })

  test("a non-preset number returns custom", () => {
    expect(currentOption(72.5)).toBe("custom")
    expect(currentOption(75)).toBe("custom")
  })

  test("null and undefined return off", () => {
    expect(currentOption(null)).toBe("off")
    expect(currentOption(undefined)).toBe("off")
  })
})

describe("autocompact thresholdOptions", () => {
  test("lists one option per preset and always offers custom and off", () => {
    const options = thresholdOptions(undefined)
    expect(options.map((option) => option.value)).toEqual([...AUTOCOMPACT_PRESETS, "custom", "off"])
    expect(options.every((option) => option.category === "Threshold")).toBe(true)
  })

  test("a custom current value retitles the custom row with the value", () => {
    const custom = thresholdOptions(72.5).find((option) => option.value === "custom")
    expect(custom?.title).toBe("Custom (72.5%)")
  })

  test("a preset or absent current value keeps the plain custom title", () => {
    for (const current of [80, undefined, null]) {
      const custom = thresholdOptions(current).find((option) => option.value === "custom")
      expect(custom?.title).toBe("Custom…")
    }
  })

  test("marks exactly the current preset", () => {
    const options = thresholdOptions(80)
    const marked = options.filter((option) => option.description?.includes("(current)"))
    expect(marked).toHaveLength(1)
    expect(marked[0]?.value).toBe(80)
  })

  test("marks Only when full when the current value is null", () => {
    for (const current of [null, undefined]) {
      const options = thresholdOptions(current)
      const marked = options.filter((option) => option.description?.includes("(current)"))
      expect(marked).toHaveLength(1)
      expect(marked[0]?.value).toBe("off")
      expect(marked[0]?.title).toBe("Only when full")
    }
  })

  test("a custom current value marks nothing", () => {
    const options = thresholdOptions(75)
    expect(options.filter((option) => option.description?.includes("(current)"))).toHaveLength(0)
  })
})

describe("autocompact saveThreshold", () => {
  function harness(overlayError: unknown) {
    const calls: unknown[] = []
    const toasts: { message: string; variant: string }[] = []
    const stored: ["config" | "globalConfig", unknown][] = []
    let refetches = 0
    const deps: ThresholdSaveDeps = {
      overlayUpdate: async (input) => {
        calls.push(input)
        return overlayError ? { error: overlayError } : {}
      },
      getConfig: async () => {
        refetches++
        return { data: { model: "cfg" } }
      },
      getGlobalConfig: async () => {
        refetches++
        return { data: { model: "global" } }
      },
      setStore: (key, value) => stored.push([key, value]),
      toast: (input) => toasts.push(input),
    }
    return { calls, toasts, stored, refetches: () => refetches, deps }
  }

  test("sends the thresholdPatch output as the overlay body", async () => {
    const h = harness(undefined)
    expect(await saveThreshold(80, h.deps)).toBe(true)
    expect(h.calls).toEqual([{ scope: "global", set: { compaction: { threshold_percent: 80 } } }])
  })

  test("an overlay error toasts and skips the refetch", async () => {
    const h = harness({ name: "Conflict" })
    expect(await saveThreshold(80, h.deps)).toBe(false)
    expect(h.toasts).toEqual([{ message: "Failed to save auto-compact threshold", variant: "error" }])
    expect(h.refetches()).toBe(0)
    expect(h.stored).toEqual([])
  })

  test("a retry after a failed save sends the same patch", async () => {
    const failing = harness({ name: "Conflict" })
    expect(await saveThreshold(70, failing.deps)).toBe(false)
    const retry = harness(undefined)
    expect(await saveThreshold(70, retry.deps)).toBe(true)
    expect(retry.calls[0]).toEqual(failing.calls[0])
  })

  test("success refetches both configs and toasts the percentage label", async () => {
    const h = harness(undefined)
    expect(await saveThreshold(90, h.deps)).toBe(true)
    expect(h.refetches()).toBe(2)
    expect(h.stored.map(([key]) => key)).toEqual(["config", "globalConfig"])
    expect(h.toasts).toEqual([{ message: "Auto-compact set to 90%", variant: "success" }])
  })

  test("disabling stores the unset patch and toasts the default label", async () => {
    const h = harness(undefined)
    expect(await saveThreshold(null, h.deps)).toBe(true)
    expect(h.calls).toEqual([{ scope: "global", unset: [["compaction", "threshold_percent"]] }])
    expect(h.toasts).toEqual([{ message: "Auto-compact set to only when full", variant: "success" }])
  })
})

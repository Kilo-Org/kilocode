import { describe, expect, test } from "bun:test"
import {
  type ModelAllocations,
  allocationKey,
  totalAllocations,
  allocationsToArray,
  remaining,
  toggleModel,
  setAllocationCount,
  maxAllocationCount,
  MAX_MULTI_VERSIONS,
} from "../../webview-ui/agent-manager/multi-model-utils"

function make(...entries: Array<[string, string, string, number]>): ModelAllocations {
  const map: ModelAllocations = new Map()
  for (const [pid, mid, name, count] of entries) {
    map.set(allocationKey(pid, mid), { providerID: pid, modelID: mid, name, count })
  }
  return map
}

describe("multi-model-utils", () => {
  test("allocationKey joins provider and model", () => {
    expect(allocationKey("anthropic", "claude-sonnet")).toBe("anthropic/claude-sonnet")
  })

  test("totalAllocations sums counts", () => {
    const alloc = make(["a", "m1", "Model 1", 2], ["b", "m2", "Model 2", 1])
    expect(totalAllocations(alloc)).toBe(3)
  })

  test("totalAllocations returns 0 for empty map", () => {
    expect(totalAllocations(new Map())).toBe(0)
  })

  test("allocationsToArray converts map to array", () => {
    const alloc = make(["a", "m1", "Model 1", 2], ["b", "m2", "Model 2", 1])
    const arr = allocationsToArray(alloc)
    expect(arr).toHaveLength(2)
    expect(arr).toContainEqual({ providerID: "a", modelID: "m1", count: 2 })
    expect(arr).toContainEqual({ providerID: "b", modelID: "m2", count: 1 })
  })

  test("remaining returns slots left", () => {
    const alloc = make(["a", "m1", "Model 1", 2], ["b", "m2", "Model 2", 1])
    expect(remaining(alloc)).toBe(MAX_MULTI_VERSIONS - 3)
  })

  test("toggleModel adds a new model with count 1", () => {
    const result = toggleModel(new Map(), "a", "m1", "Model 1")
    expect(result.size).toBe(1)
    expect(result.get("a/m1")).toEqual({ providerID: "a", modelID: "m1", name: "Model 1", count: 1 })
  })

  test("toggleModel removes an existing model", () => {
    const alloc = make(["a", "m1", "Model 1", 1])
    const result = toggleModel(alloc, "a", "m1", "Model 1")
    expect(result.size).toBe(0)
  })

  test("toggleModel does not add when at max capacity", () => {
    const alloc = make(["a", "m1", "A", 2], ["b", "m2", "B", 2])
    expect(totalAllocations(alloc)).toBe(MAX_MULTI_VERSIONS)
    const result = toggleModel(alloc, "c", "m3", "C")
    expect(result.size).toBe(2)
    expect(result.has("c/m3")).toBe(false)
  })

  test("setAllocationCount changes count for existing model", () => {
    const alloc = make(["a", "m1", "Model 1", 1])
    const result = setAllocationCount(alloc, "a", "m1", 3)
    expect(result.get("a/m1")?.count).toBe(3)
  })

  test("setAllocationCount rejects count below 1", () => {
    const alloc = make(["a", "m1", "Model 1", 2])
    expect(setAllocationCount(alloc, "a", "m1", 0)).toBe(alloc)
    expect(setAllocationCount(alloc, "a", "m1", -1)).toBe(alloc)
  })

  test("setAllocationCount does nothing for non-existent model", () => {
    const alloc = make(["a", "m1", "Model 1", 1])
    const result = setAllocationCount(alloc, "b", "m2", 2)
    expect(result).toBe(alloc)
  })

  test("setAllocationCount refuses if would exceed max", () => {
    const alloc = make(["a", "m1", "A", 1], ["b", "m2", "B", 2])
    const result = setAllocationCount(alloc, "a", "m1", 3)
    // would be 3 + 2 = 5, exceeding 4
    expect(result).toBe(alloc)
  })

  test("setAllocationCount allows decrease even at max", () => {
    const alloc = make(["a", "m1", "A", 2], ["b", "m2", "B", 2])
    const result = setAllocationCount(alloc, "a", "m1", 1)
    expect(result.get("a/m1")?.count).toBe(1)
  })

  test("maxAllocationCount for selected model includes its current count", () => {
    const alloc = make(["a", "m1", "A", 1], ["b", "m2", "B", 2])
    // remaining = 4 - 3 = 1, current = 1, so max = 1 + 1 = 2
    expect(maxAllocationCount(alloc, "a", "m1")).toBe(2)
  })

  test("maxAllocationCount for unselected model is just remaining", () => {
    const alloc = make(["a", "m1", "A", 2])
    // remaining = 4 - 2 = 2, current = 0, so max = 0 + 2 = 2
    expect(maxAllocationCount(alloc, "b", "m2")).toBe(2)
  })
})

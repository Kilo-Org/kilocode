import { expect, test } from "bun:test"
import { modelGroups } from "../src/model-picker"

test("Kilo groups use actual inventory IDs and recommendation order, not invented defaults", () => {
  const groups = modelGroups(
    [
      { providerID: "kilo", modelID: "kilo-auto/free" },
      { providerID: "kilo", modelID: "recommended" },
      { providerID: "kilo", modelID: "ordinary" },
      { providerID: "other", modelID: "recommended" },
    ],
    [
      { id: "recommended", recommendedIndex: 0 },
      { id: "not-in-catalog", recommendedIndex: 1 },
    ],
  )
  expect(groups.map((group) => group.category)).toEqual(["Kilo Auto", "Recommended"])
  expect(groups[0]!.order).toBeLessThan(groups[1]!.order)
  expect(groups.map((group) => group.modelID)).toEqual(["kilo-auto/free", "recommended"])
})

test("missing metadata leaves real Auto IDs grouped but invents no recommendations", () => {
  expect(modelGroups([{ providerID: "kilo", modelID: "kilo-auto/efficient" }], [])).toEqual([
    { providerID: "kilo", modelID: "kilo-auto/efficient", category: "Kilo Auto", order: 0 },
  ])
  expect(modelGroups([{ providerID: "kilo", modelID: "ordinary" }], [])).toEqual([])
})

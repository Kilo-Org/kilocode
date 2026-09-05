import { expect, test } from "bun:test"
import type { OpenCode } from "@opencode-ai/client"
import { createModelPicker, modelGroups } from "../src/model-picker"

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
  expect(groups[0]!.order!).toBeLessThan(groups[1]!.order!)
  expect(groups.map((group) => group.modelID)).toEqual(["kilo-auto/free", "recommended"])
})

test("known Kilo Auto IDs group without catalog metadata but invent no recommendations", () => {
  expect(
    modelGroups(
      [
        { providerID: "kilo", modelID: "kilo-auto/efficient" },
        { providerID: "kilo", modelID: "auto-small" },
      ],
      [],
    ),
  ).toEqual([
    { providerID: "kilo", modelID: "kilo-auto/efficient", category: "Kilo Auto", order: 0 },
    { providerID: "kilo", modelID: "auto-small", category: "Kilo Auto", order: 0 },
  ])
  expect(modelGroups([{ providerID: "kilo", modelID: "ordinary" }], [])).toEqual([])
})

test("routing metadata does not classify a regular Kilo model as Auto", () => {
  expect(
    modelGroups(
      [{ providerID: "kilo", modelID: "regular-with-routing-metadata" }],
      [{ id: "regular-with-routing-metadata", autoRouting: { models: ["provider/model"] } }],
    ),
  ).toEqual([])
})

test("catalog disclosures do not invent groups, BYOK availability, or privacy guarantees", () => {
  expect(
    modelGroups(
      [
        { providerID: "kilo", modelID: "plain" },
        { providerID: "kilo", modelID: "recommended" },
        { providerID: "kilo", modelID: "unknown" },
        { providerID: "kilo", modelID: "explicit-false" },
        { providerID: "other", modelID: "plain" },
      ],
      [
        { id: "plain", hasUserByokAvailable: true, mayTrainOnYourPrompts: true },
        { id: "recommended", recommendedIndex: 0, hasUserByokAvailable: true },
        { id: "explicit-false", hasUserByokAvailable: false, mayTrainOnYourPrompts: false },
      ],
    ),
  ).toEqual([
    { providerID: "kilo", modelID: "plain", footer: "BYOK · May train" },
    { providerID: "kilo", modelID: "recommended", category: "Recommended", order: 2, footer: "BYOK" },
  ])
})

test("metadata requests are abortable and pass each current location through", async () => {
  const calls: Array<{ location?: { directory: string }; signal?: AbortSignal }> = []
  const picker = createModelPicker({
    rpc() {
      return {
        list(_: {}, options: { location?: { directory: string }; signal?: AbortSignal }) {
          calls.push(options)
          if (calls.length === 1)
            return new Promise<[]>((_, reject) =>
              options.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
            )
          if (calls.length === 3) return Promise.reject(new Error("metadata unavailable"))
          return Promise.resolve([{ id: "new-account-recommendation", recommendedIndex: 0 }])
        },
      }
    },
  } as unknown as ReturnType<typeof OpenCode.make>)
  const first = new AbortController()
  const input = (directory: string) => ({
    location: { directory },
    models: [{ providerID: "kilo", modelID: "new-account-recommendation" }],
  })

  const aborted = picker.groups!(input("/first-location"), first.signal)
  first.abort(new Error("dialog closed"))
  await expect(aborted).rejects.toThrow("dialog closed")

  await expect(picker.groups!(input("/second-location"), new AbortController().signal)).resolves.toEqual([
    { providerID: "kilo", modelID: "new-account-recommendation", category: "Recommended", order: 2 },
  ])
  await expect(picker.groups!(input("/second-location"), new AbortController().signal)).rejects.toThrow(
    "metadata unavailable",
  )
  expect(calls.map((call) => call.location?.directory)).toEqual([
    "/first-location",
    "/second-location",
    "/second-location",
  ])
})

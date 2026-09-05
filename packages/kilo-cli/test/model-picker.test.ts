import { expect, test } from "bun:test"
import type { OpenCode } from "@opencode-ai/client"
import { createModelPicker, modelGroups } from "../src/model-picker"
import type { SettingsSnapshot } from "../src/settings-rpc"

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

test("the training-model filter hides only real may-train metadata, never unknown or other providers", () => {
  const metadata = [
    { id: "recommended", recommendedIndex: 0 },
    { id: "flagged", mayTrainOnYourPrompts: true },
    { id: "explicit-false", mayTrainOnYourPrompts: false },
    { id: "kilo-auto/flagged", mayTrainOnYourPrompts: true },
  ]
  const models = [
    { providerID: "kilo", modelID: "flagged" },
    { providerID: "kilo", modelID: "recommended" },
    { providerID: "kilo", modelID: "explicit-false" },
    { providerID: "kilo", modelID: "unknown" },
    { providerID: "kilo", modelID: "kilo-auto/flagged" },
    { providerID: "other", modelID: "flagged" },
  ]
  // Without the setting, presentation is byte-identical to the unfiltered form.
  expect(modelGroups(models, metadata, false)).toEqual(modelGroups(models, metadata))
  expect(modelGroups(models, metadata, true)).toEqual([
    { providerID: "kilo", modelID: "flagged", hidden: true },
    { providerID: "kilo", modelID: "recommended", category: "Recommended", order: 2 },
    { providerID: "kilo", modelID: "kilo-auto/flagged", hidden: true },
  ])
})

test("metadata requests are abortable and pass each current location through", async () => {
  const calls: Array<{ location?: { directory: string }; signal?: AbortSignal }> = []
  const settingsCalls: Array<{ location?: { directory: string }; signal?: AbortSignal }> = []
  const picker = createModelPicker({
    rpc(definition: { id: string }) {
      if (definition.id === "kilocode.settings")
        return {
          read(_: {}, options: { location?: { directory: string }; signal?: AbortSignal }) {
            settingsCalls.push(options)
            return Promise.resolve(snapshotWith([]))
          },
        }
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
  // The effective preference is read live at the same location, without caching.
  expect(settingsCalls.map((call) => call.location?.directory)).toEqual([
    "/first-location",
    "/second-location",
    "/second-location",
  ])
})

test("the picker follows the effective project-over-profile preference with strict true", async () => {
  const models = [
    { providerID: "kilo", modelID: "flagged" },
    { providerID: "kilo", modelID: "unknown" },
  ]
  const metadata = [{ id: "flagged", mayTrainOnYourPrompts: true }]
  const snapshots: SettingsSnapshot["fields"][] = []
  const picker = createModelPicker({
    rpc(definition: { id: string }) {
      if (definition.id === "kilocode.settings")
        return {
          read() {
            return Promise.resolve(snapshotWith(snapshots.shift() ?? []))
          },
        }
      return { list: () => Promise.resolve(metadata) }
    },
  } as unknown as ReturnType<typeof OpenCode.make>)
  const input = { location: { directory: "/any" }, models }
  const visible = [{ providerID: "kilo", modelID: "flagged", footer: "May train" }]
  const hidden = [{ providerID: "kilo", modelID: "flagged", hidden: true }]

  // Profile-only true hides; a wrong-typed stored value never hides anything.
  snapshots.push([field({ profile: true })])
  await expect(picker.groups!(input, new AbortController().signal)).resolves.toEqual(hidden)
  snapshots.push([field({ profile: "yes" })])
  await expect(picker.groups!(input, new AbortController().signal)).resolves.toEqual(visible)
  // An explicit project false overrides a profile true; project true wins over profile.
  snapshots.push([field({ profile: true, project: false })])
  await expect(picker.groups!(input, new AbortController().signal)).resolves.toEqual(visible)
  snapshots.push([field({ profile: false, project: true })])
  await expect(picker.groups!(input, new AbortController().signal)).resolves.toEqual(hidden)
})

type SnapshotField = SettingsSnapshot["fields"][number]

function field(values: SnapshotField["values"]): SnapshotField {
  return {
    key: "hide_prompt_training_models",
    title: "",
    description: "",
    kind: "boolean",
    values,
    source: "unset",
  }
}

function snapshotWith(fields: SettingsSnapshot["fields"]): SettingsSnapshot {
  return { scopes: [], fields, restartRequired: false, note: "" }
}

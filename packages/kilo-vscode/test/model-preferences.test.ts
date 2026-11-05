// The host storage rules of the model picker preferences, as v1 `provider-actions.ts` and `model-usage.ts`.
import { describe, expect, test } from "bun:test"
import {
  applyModelPreference,
  FAVORITES_KEY,
  readModelPreferences,
  RECENTS_KEY,
  recordUsage,
  toggleFavorite,
  USAGE_KEY,
  validateRecents,
  validateUsage,
  VARIANTS_KEY,
} from "../src/model-preferences"

const ref = (providerID: string, modelID: string) => ({ providerID, modelID })

describe("toggleFavorite", () => {
  test("adds once and removes", () => {
    const added = toggleFavorite(toggleFavorite([], "add", ref("kilo", "a")), "add", ref("kilo", "a"))
    expect(added).toEqual([ref("kilo", "a")])
    expect(toggleFavorite(added, "remove", ref("kilo", "a"))).toEqual([])
  })
})

describe("validateRecents", () => {
  test("drops invalid entries and duplicates and keeps at most 5", () => {
    const raw = [
      ref("kilo", "a"),
      { providerID: "kilo" },
      ref("kilo", "a"),
      ...["b", "c", "d", "e", "f"].map((id) => ref("x", id)),
    ]
    expect(validateRecents(raw)).toEqual([ref("kilo", "a"), ref("x", "b"), ref("x", "c"), ref("x", "d"), ref("x", "e")])
  })
})

describe("recordUsage", () => {
  test("counts each prompt and stamps the time", () => {
    const once = recordUsage(undefined, ref("kilo", "a"), 10)
    expect(recordUsage(once, ref("kilo", "a"), 20)).toEqual({ "kilo/a": { count: 2, lastUsed: 20 } })
  })

  test("keeps the 200 most recently used models", () => {
    const raw = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`p/m${i}`, { count: 1, lastUsed: i }]))
    const usage = validateUsage(raw)
    expect(Object.keys(usage)).toHaveLength(200)
    expect(usage["p/m249"]).toBeDefined()
    expect(usage["p/m49"]).toBeUndefined()
  })
})

describe("readModelPreferences", () => {
  test("reads empty defaults from missing or malformed state", () => {
    const state = new Map<string, unknown>([
      [FAVORITES_KEY, "nope"],
      [RECENTS_KEY, [ref("kilo", "a")]],
      [USAGE_KEY, { "kilo/a": { count: -1, lastUsed: 1 } }],
      [VARIANTS_KEY, { "agent/code/kilo/a": "high", bad: 1 }],
    ])
    const prefs = readModelPreferences({ get: (key) => state.get(key), update: async () => undefined })
    expect(prefs).toEqual({
      favorites: [],
      recents: [ref("kilo", "a")],
      usage: {},
      variants: { "agent/code/kilo/a": "high" },
    })
  })
})

describe("applyModelPreference", () => {
  test("serializes fast writes so no change is lost", async () => {
    const state = new Map<string, unknown>()
    // A slow store: each update resolves later, as the real globalState can.
    const store = {
      get: (key: string) => state.get(key),
      update: (key: string, value: unknown) =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            state.set(key, value)
            resolve()
          }, 5),
        ),
    }
    await Promise.all([
      applyModelPreference(store, { type: "toggleFavorite", action: "add", ...ref("kilo", "a") }),
      applyModelPreference(store, { type: "toggleFavorite", action: "add", ...ref("kilo", "b") }),
      applyModelPreference(store, { type: "persistVariant", key: "agent/code/kilo/a", value: "high" }),
      applyModelPreference(store, { type: "persistVariant", key: "agent/code/kilo/b", value: "low" }),
    ])
    const prefs = readModelPreferences(store)
    expect(prefs.favorites).toEqual([ref("kilo", "a"), ref("kilo", "b")])
    expect(prefs.variants).toEqual({ "agent/code/kilo/a": "high", "agent/code/kilo/b": "low" })
  })
})

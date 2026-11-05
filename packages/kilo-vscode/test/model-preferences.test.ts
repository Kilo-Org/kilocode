// The host storage rules of the model picker preferences, as v1 `provider-actions.ts` and `model-usage.ts`.
import { describe, expect, test } from "bun:test"
import {
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

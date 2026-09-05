import { expect, test } from "bun:test"
import { sortModelOptions } from "../../src/component/dialog-model"

const options = [
  { providerID: "kilo", providerName: "Kilo Gateway", title: "Kilo", releaseDate: 0 },
  { providerID: "opencode", providerName: "OpenCode Zen", title: "Zen", releaseDate: 0 },
  { providerID: "aaa", providerName: "AAA", title: "Other", releaseDate: 0 },
]

test("host provider preference preserves the upstream default when omitted", () => {
  expect(sortModelOptions(options).map((item) => item.providerID)).toEqual(["opencode", "aaa", "kilo"])
  expect(sortModelOptions(options, "kilo").map((item) => item.providerID)).toEqual(["kilo", "aaa", "opencode"])
  expect(options[0]!.providerID).toBe("kilo")
})

test("scoped display groups sort ahead of providers without modifying option identities", () => {
  const grouped = [
    ...options,
    { providerID: "kilo", providerName: "Kilo Gateway", title: "Recommended", releaseDate: 0, groupOrder: 1 },
    { providerID: "kilo", providerName: "Kilo Gateway", title: "Auto", releaseDate: 0, groupOrder: 0 },
  ]
  expect(sortModelOptions(grouped, "kilo").map((item) => item.title)).toEqual([
    "Auto",
    "Recommended",
    "Kilo",
    "Other",
    "Zen",
  ])
})

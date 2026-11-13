import { describe, expect, test } from "bun:test"
import { isSmallModel, pickerModels } from "../webview-ui/src/components/shared/model-selector-filter"

const model = (providerID: string, id: string, overrides: { enabled?: boolean; status?: string } = {}) => ({
  providerID,
  id,
  enabled: overrides.enabled ?? true,
  status: overrides.status ?? "active",
})

describe("isSmallModel", () => {
  test("is the Gateway small model and its v1 alias", () => {
    expect(isSmallModel(model("kilo", "kilo-auto/small"))).toBe(true)
    expect(isSmallModel(model("kilo", "auto-small"))).toBe(true)
  })

  test("is not a small model under another provider or another model id", () => {
    expect(isSmallModel(model("other", "kilo-auto/small"))).toBe(false)
    expect(isSmallModel(model("kilo", "kilo-auto/free"))).toBe(false)
  })
})

describe("pickerModels", () => {
  const models = [
    model("kilo", "kilo-auto/free"),
    model("kilo", "kilo-auto/small"),
    model("kilo", "auto-small"),
    model("kilo", "kilo-auto/disabled", { enabled: false }),
    model("kilo", "kilo-auto/deprecated", { status: "deprecated" }),
  ]

  test("hides the small model in a regular picker", () => {
    expect(pickerModels(models).map((item) => item.id)).toEqual(["kilo-auto/free"])
  })

  test("shows the small model in the small model row", () => {
    expect(pickerModels(models, true).map((item) => item.id)).toEqual([
      "kilo-auto/free",
      "kilo-auto/small",
      "auto-small",
    ])
  })
})

import { describe, expect, test } from "bun:test"
import { hasGateway, visible } from "./privacy"

describe("model privacy filter", () => {
  test("detects when Kilo Gateway models are present", () => {
    expect(hasGateway([{ id: "kilo" }, { id: "openai" }])).toBe(true)
    expect(hasGateway([{ id: "openai" }])).toBe(false)
  })

  test("shows every model when disabled", () => {
    expect(visible({ id: "kilo" }, { mayTrainOnYourPrompts: true }, false)).toBe(true)
  })

  test("hides only Kilo Gateway models explicitly marked for prompt training", () => {
    expect(visible({ id: "kilo" }, { mayTrainOnYourPrompts: true }, true)).toBe(false)
    expect(visible({ id: "kilo" }, { mayTrainOnYourPrompts: false }, true)).toBe(true)
    expect(visible({ id: "kilo" }, {}, true)).toBe(true)
    expect(visible({ id: "openai" }, { mayTrainOnYourPrompts: true }, true)).toBe(true)
  })
})

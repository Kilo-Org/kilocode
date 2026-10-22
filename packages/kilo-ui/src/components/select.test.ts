import { describe, expect, test } from "bun:test"
import { changed } from "./select-change"

describe("changed", () => {
  const key = (item: { value: string }) => item.value

  test("ignores recreated options with the current key", () => {
    expect(changed({ value: "ollama" }, { value: "ollama" }, key)).toBe(false)
  })

  test("reports selected and cleared values", () => {
    expect(changed({ value: "ollama" }, { value: "kilo" }, key)).toBe(true)
    expect(changed({ value: "ollama" }, undefined, key)).toBe(true)
    expect(changed(undefined, { value: "ollama" }, key)).toBe(true)
    expect(changed(undefined, undefined, key)).toBe(false)
  })
})

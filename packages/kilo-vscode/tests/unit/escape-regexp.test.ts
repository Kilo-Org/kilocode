import { describe, expect, it } from "bun:test"
import { escapeRegExp } from "../../webview-ui/src/utils/escape-regexp"

describe("escapeRegExp", () => {
  it("escapes regex syntax so the value only matches literally", () => {
    const value = "a.b(c)+d?[e]\\f^g$h|i{j}"
    const pattern = new RegExp(`^${escapeRegExp(value)}$`)
    expect(pattern.test(value)).toBe(true)
    expect(pattern.test(`${value}x`)).toBe(false)
    expect(pattern.test(value.slice(0, -1))).toBe(false)
  })

  it("leaves plain text matchable", () => {
    expect(new RegExp(`^${escapeRegExp("plain text")}$`).test("plain text")).toBe(true)
    expect(new RegExp(`^${escapeRegExp("1.2.3")}$`).test("1x2x3")).toBe(false)
  })
})

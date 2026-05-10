import { describe, expect, test } from "bun:test"
import { isValidHex, hexToRgb, hexToAnsiBold } from "../../src/util/color"

describe("isValidHex", () => {
  test("returns true for valid 6-char hex with #", () => {
    expect(isValidHex("#a1b2c3")).toBe(true)
    expect(isValidHex("#FF0000")).toBe(true)
    expect(isValidHex("#000000")).toBe(true)
    expect(isValidHex("#ffffff")).toBe(true)
  })

  test("returns false for invalid hex", () => {
    expect(isValidHex("#FFF")).toBe(false)
    expect(isValidHex("#GGG")).toBe(false)
    expect(isValidHex("a1b2c3")).toBe(false)
    expect(isValidHex("")).toBe(false)
    expect(isValidHex("12345")).toBe(false)
    expect(isValidHex("#1234567")).toBe(false)
  })
})

describe("hexToRgb", () => {
  test("converts valid hex to RGB", () => {
    expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 })
    expect(hexToRgb("#00FF00")).toEqual({ r: 0, g: 255, b: 0 })
    expect(hexToRgb("#0000FF")).toEqual({ r: 0, g: 0, b: 255 })
  })
})

describe("hexToAnsiBold", () => {
  test("converts valid hex to ANSI bold escape sequence", () => {
    expect(hexToAnsiBold("#FF0000")).toBe("\x1b[38;2;255;0;0m\x1b[1m")
    expect(hexToAnsiBold("#00FF00")).toBe("\x1b[38;2;0;255;0m\x1b[1m")
    expect(hexToAnsiBold("#0000FF")).toBe("\x1b[38;2;0;0;255m\x1b[1m")
    expect(hexToAnsiBold("#000000")).toBe("\x1b[38;2;0;0;0m\x1b[1m")
  })

  test("returns undefined for invalid hex", () => {
    expect(hexToAnsiBold("#FFF")).toBe(undefined)
    expect(hexToAnsiBold("")).toBe(undefined)
  })
})
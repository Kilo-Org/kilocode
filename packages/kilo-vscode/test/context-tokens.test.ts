import { describe, expect, test } from "bun:test"
import { limitEdit, limitFromBuffer, tokenEdit } from "../webview-ui/src/components/settings/context-tokens"

describe("tokenEdit", () => {
  test("clears the key for a blank value", () => {
    expect(tokenEdit("")).toEqual({ type: "unset" })
    expect(tokenEdit("   ")).toEqual({ type: "unset" })
  })

  test("sets a whole number of tokens", () => {
    expect(tokenEdit("0")).toEqual({ type: "set", value: 0 })
    expect(tokenEdit("012")).toEqual({ type: "set", value: 12 })
    expect(tokenEdit(" 12000 ")).toEqual({ type: "set", value: 12000 })
  })

  test("ignores text that is not a whole number", () => {
    expect(tokenEdit("-1")).toBeUndefined()
    expect(tokenEdit("1.5")).toBeUndefined()
    expect(tokenEdit("1e5")).toBeUndefined()
    expect(tokenEdit("abc")).toBeUndefined()
  })
})

describe("limitEdit", () => {
  test("clears the key for a blank value", () => {
    expect(limitEdit("")).toEqual({ type: "unset" })
    expect(limitEdit("   ")).toEqual({ type: "unset" })
  })

  test("sets the complement of the limit as the buffer percentage", () => {
    expect(limitEdit("80")).toEqual({ type: "set", value: "20%" })
    expect(limitEdit("1")).toEqual({ type: "set", value: "99%" })
    expect(limitEdit("99")).toEqual({ type: "set", value: "1%" })
    expect(limitEdit(" 80 ")).toEqual({ type: "set", value: "20%" })
  })

  test("keeps no room free at a full limit", () => {
    expect(limitEdit("100")).toEqual({ type: "set", value: 0 })
  })

  test("sets a fractional limit as a fractional buffer", () => {
    expect(limitEdit("80.5")).toEqual({ type: "set", value: "19.5%" })
    expect(limitEdit("0.5")).toEqual({ type: "set", value: "99.5%" })
  })

  test("ignores a limit outside the buffer percentage range", () => {
    expect(limitEdit("0")).toBeUndefined()
    expect(limitEdit("101")).toBeUndefined()
    // A buffer percentage cannot go below 1%, so a limit just under 100 has no percentage form.
    expect(limitEdit("99.5")).toBeUndefined()
    expect(limitEdit("80%")).toBeUndefined()
    expect(limitEdit("abc")).toBeUndefined()
  })
})

describe("limitFromBuffer", () => {
  test("complements a buffer percentage", () => {
    expect(limitFromBuffer("20%")).toBe("80")
    expect(limitFromBuffer("1%")).toBe("99")
    expect(limitFromBuffer("99.5%")).toBe("0.5")
    expect(limitFromBuffer("99.9%")).toBe("0.1")
  })

  test("reads a zero token buffer as a full limit", () => {
    expect(limitFromBuffer(0)).toBe("100")
  })

  test("leaves the limit blank for a token buffer or no value", () => {
    expect(limitFromBuffer(20000)).toBe("")
    expect(limitFromBuffer(undefined)).toBe("")
    expect(limitFromBuffer("abc")).toBe("")
  })
})

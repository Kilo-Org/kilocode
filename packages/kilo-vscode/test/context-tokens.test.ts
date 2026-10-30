import { describe, expect, test } from "bun:test"
import { tokenEdit } from "../webview-ui/src/components/settings/context-tokens"

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

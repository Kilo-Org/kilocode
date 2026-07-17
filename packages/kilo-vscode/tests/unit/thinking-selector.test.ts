import { describe, expect, it } from "bun:test"
import { thinkingRows } from "../../webview-ui/src/components/shared/thinking-selector-utils"

describe("thinkingRows", () => {
  it("does not add a default row when no variants exist", () => {
    expect(thinkingRows([], true)).toHaveLength(0)
  })

  it("adds a default row when variants can be cleared", () => {
    expect(thinkingRows(["low", "medium", "high"], true)).toEqual([undefined, "low", "medium", "high"])
  })

  it("leaves variants unchanged when they cannot be cleared", () => {
    expect(thinkingRows(["low"], false)).toEqual(["low"])
  })
})

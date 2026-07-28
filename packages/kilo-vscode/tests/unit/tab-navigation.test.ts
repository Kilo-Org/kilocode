import { describe, expect, it } from "bun:test"
import { handleTabKey, tabForKey } from "../../webview-ui/src/utils/tab-navigation"

describe("tab keyboard navigation", () => {
  const ids = ["first", "middle", "last"]

  it("wraps arrow navigation", () => {
    expect(tabForKey(ids, "first", "ArrowLeft")).toBe("last")
    expect(tabForKey(ids, "last", "ArrowRight")).toBe("first")
  })

  it("moves to the bounds with Home and End", () => {
    expect(tabForKey(ids, "middle", "Home")).toBe("first")
    expect(tabForKey(ids, "middle", "End")).toBe("last")
  })

  it("ignores unrelated keys and missing tabs", () => {
    expect(tabForKey(ids, "middle", "Enter")).toBeUndefined()
    expect(tabForKey(ids, "missing", "ArrowRight")).toBeUndefined()
  })

  it("does not treat modified arrows as standard tab navigation", () => {
    const target = {}
    const selected: string[] = []
    handleTabKey({
      ids,
      id: "middle",
      event: {
        key: "ArrowRight",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        target,
        currentTarget: target,
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent,
      select: (id) => selected.push(id),
      root: null,
    })
    expect(selected).toEqual([])
  })
})

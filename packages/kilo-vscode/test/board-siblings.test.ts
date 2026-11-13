import { describe, expect, it } from "bun:test"
import { boardSiblings } from "../webview-ui/src/v2/board-siblings"

const family = new Map<string, string | undefined>([
  ["root", undefined],
  ["child-a", "root"],
  ["child-b", "root"],
  ["grandchild", "child-a"],
])

describe("boardSiblings", () => {
  it("uses the family root so a subagent transcript sees its own siblings", () => {
    expect(boardSiblings("root", ["root", "child-a", "child-b", "grandchild"], (id) => family.get(id))).toEqual([
      "child-a",
      "child-b",
    ])
  })

  it("does not include the root itself", () => {
    expect(boardSiblings("root", ["root"], () => undefined)).toEqual([])
  })

  it("stays empty without a known family", () => {
    expect(boardSiblings("missing", [], () => undefined)).toEqual([])
  })
})

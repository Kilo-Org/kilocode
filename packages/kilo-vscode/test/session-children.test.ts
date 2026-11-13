import { describe, expect, it } from "bun:test"
import { sessionChildren } from "../webview-ui/src/v2/session-children"

const family = new Map<string, string | undefined>([
  ["root", undefined],
  ["child-a", "root"],
  ["child-b", "root"],
  ["grandchild", "child-a"],
])

describe("sessionChildren", () => {
  it("uses the open session as the parent", () => {
    expect(sessionChildren("root", ["root", "child-a", "child-b", "grandchild"], (id) => family.get(id))).toEqual([
      "child-a",
      "child-b",
    ])
  })

  it("keeps a subagent transcript on its own children", () => {
    expect(sessionChildren("child-a", ["root", "child-a", "child-b", "grandchild"], (id) => family.get(id))).toEqual([
      "grandchild",
    ])
  })

  it("does not include the session itself", () => {
    expect(sessionChildren("root", ["root"], () => undefined)).toEqual([])
  })
})

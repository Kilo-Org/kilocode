import { describe, expect, it } from "bun:test"
import { tabForKey } from "../webview-ui/src/utils/tab-navigation"

const history = ["local", "worktree"]

describe("tabForKey", () => {
  it("moves between history source tabs with wrapping arrows", () => {
    expect(tabForKey(history, "local", "ArrowRight")).toBe("worktree")
    expect(tabForKey(history, "worktree", "ArrowRight")).toBe("local")
    expect(tabForKey(history, "local", "ArrowLeft")).toBe("worktree")
    expect(tabForKey(history, "worktree", "ArrowLeft")).toBe("local")
  })

  it("jumps to the first and last tab", () => {
    expect(tabForKey(history, "worktree", "Home")).toBe("local")
    expect(tabForKey(history, "local", "End")).toBe("worktree")
  })

  it("ignores keys that do not move tabs", () => {
    expect(tabForKey(history, "local", "Enter")).toBeUndefined()
    expect(tabForKey(history, "local", "Tab")).toBeUndefined()
  })
})
import { describe, expect, it } from "bun:test"
import { findSessionTab, sessionLocation } from "../../src/kilo-provider/session-tabs"

describe("sessionLocation", () => {
  it("defaults to the sidebar", () => {
    expect(sessionLocation(undefined)).toBe("sidebar")
    expect(sessionLocation("sidebar")).toBe("sidebar")
  })

  it("accepts editorTab and falls back for unknown values", () => {
    expect(sessionLocation("editorTab")).toBe("editorTab")
    expect(sessionLocation("window")).toBe("sidebar")
    expect(sessionLocation(1)).toBe("sidebar")
  })
})

describe("findSessionTab", () => {
  const chat = (id?: string) => ({ getCurrentSessionId: () => id })

  it("returns the panel showing the session", () => {
    const tabs = new Map([
      ["a", chat("one")],
      ["b", chat("two")],
    ])
    expect(findSessionTab(tabs, "two")).toBe("b")
  })

  it("returns undefined when no tab shows it", () => {
    const tabs = new Map([
      ["a", chat("one")],
      ["b", chat()],
    ])
    expect(findSessionTab(tabs, "three")).toBeUndefined()
    expect(findSessionTab(new Map(), "one")).toBeUndefined()
  })

  it("follows a tab that switched sessions after it opened", () => {
    let id = "one"
    const tabs = new Map([["a", { getCurrentSessionId: () => id }]])
    expect(findSessionTab(tabs, "one")).toBe("a")
    id = "two"
    expect(findSessionTab(tabs, "one")).toBeUndefined()
    expect(findSessionTab(tabs, "two")).toBe("a")
  })
})

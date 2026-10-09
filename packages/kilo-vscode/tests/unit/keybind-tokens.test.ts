import { describe, expect, it } from "bun:test"
import { parseBindingGroups } from "../../webview-ui/src/utils/keybind-tokens"

describe("parseBindingGroups", () => {
  it("splits a Mac binding into keys", () => {
    expect(parseBindingGroups("⌘⇧R")).toEqual([["⌘", "⇧", "R"]])
  })

  it("splits a Windows binding into keys", () => {
    expect(parseBindingGroups("Ctrl+Shift+R")).toEqual([["Ctrl", "Shift", "R"]])
  })

  it("gives one group per chord part or key pair", () => {
    expect(parseBindingGroups("⌘K ⌘A")).toEqual([
      ["⌘", "K"],
      ["⌘", "A"],
    ])
    expect(parseBindingGroups("Ctrl+Alt+Up Ctrl+Alt+Down")).toEqual([
      ["Ctrl", "Alt", "Up"],
      ["Ctrl", "Alt", "Down"],
    ])
  })

  it("keeps a single named key", () => {
    expect(parseBindingGroups("Esc")).toEqual([["Esc"]])
  })
})

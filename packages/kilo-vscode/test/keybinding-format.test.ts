import { describe, expect, it } from "bun:test"
import * as path from "node:path"
import {
  formatKeybinding,
  mergeUserKeybindings,
  parseJsonc,
  resolvePromptKeybindings,
  userKeybindingFiles,
  type Binding,
} from "../src/keybinding-format"

const defaults: Binding[] = [
  { command: "kilo-code.v2.cycleAgentMode", key: "ctrl+.", mac: "cmd+." },
  { command: "kilo-code.v2.cyclePreviousAgentMode", key: "ctrl+shift+.", mac: "cmd+shift+." },
]

describe("formatKeybinding", () => {
  it("formats modifiers on mac", () => {
    expect(formatKeybinding("cmd+w", true)).toBe("⌘W")
    expect(formatKeybinding("cmd+shift+w", true)).toBe("⌘⇧W")
    expect(formatKeybinding("ctrl+c", true)).toBe("⌃C")
    expect(formatKeybinding("alt+f", true)).toBe("⌥F")
    expect(formatKeybinding("cmd+shift+alt+t", true)).toBe("⌘⇧⌥T")
  })

  it("formats modifiers off mac", () => {
    expect(formatKeybinding("cmd+w", false)).toBe("Ctrl+W")
    expect(formatKeybinding("ctrl+shift+w", false)).toBe("Ctrl+Shift+W")
    expect(formatKeybinding("alt+f", false)).toBe("Alt+F")
    expect(formatKeybinding("ctrl+shift+alt+t", false)).toBe("Ctrl+Shift+Alt+T")
  })

  it("formats arrows and special keys", () => {
    expect(formatKeybinding("cmd+left", true)).toBe("⌘←")
    expect(formatKeybinding("cmd+right", true)).toBe("⌘→")
    expect(formatKeybinding("cmd+backspace", true)).toBe("⌘⌫")
    expect(formatKeybinding("cmd+enter", true)).toBe("⌘↵")
    expect(formatKeybinding("escape", true)).toBe("Esc")
  })

  it("formats chords", () => {
    expect(formatKeybinding("cmd+k cmd+d", true)).toBe("⌘K ⌘D")
    expect(formatKeybinding("ctrl+k ctrl+d", false)).toBe("Ctrl+K Ctrl+D")
  })
})

describe("parseJsonc", () => {
  it("accepts comments and trailing commas but not comment markers inside strings", () => {
    const text = `// Place your key bindings in this file
[
  { "key": "cmd+j", "command": "kilo-code.v2.cycleAgentMode" }, /* block */
  { "key": "cmd+//", "command": "x", "when": "a // not a comment" },
]`
    expect(parseJsonc(text)).toEqual([
      { key: "cmd+j", command: "kilo-code.v2.cycleAgentMode" },
      { key: "cmd+//", command: "x", when: "a // not a comment" },
    ])
  })

  it("returns undefined for invalid JSON", () => {
    expect(parseJsonc("[ { ")).toBeUndefined()
  })
})

describe("mergeUserKeybindings", () => {
  it("resolves the platform default when the user has no override", () => {
    const merged = mergeUserKeybindings(defaults, undefined, true)
    expect(merged.map((b) => b.key)).toEqual(["cmd+.", "cmd+shift+."])
  })

  it("keeps the user's override after the default", () => {
    const merged = mergeUserKeybindings(defaults, [{ key: "cmd+j", command: "kilo-code.v2.cycleAgentMode" }], true)
    expect(merged.at(-1)).toEqual({ command: "kilo-code.v2.cycleAgentMode", key: "cmd+j", when: undefined })
  })

  it("removes a command when the user disables the same key", () => {
    const merged = mergeUserKeybindings(defaults, [{ key: "cmd+.", command: "-kilo-code.v2.cycleAgentMode" }], true)
    expect(merged.filter((b) => b.command === "kilo-code.v2.cycleAgentMode" && b.key)).toEqual([])
  })

  it("keeps the default when the removed command names a different key", () => {
    const merged = mergeUserKeybindings(defaults, [{ key: "cmd+x", command: "-kilo-code.v2.cycleAgentMode" }], true)
    expect(merged.find((b) => b.command === "kilo-code.v2.cycleAgentMode" && b.key)?.key).toBe("cmd+.")
  })
})

describe("userKeybindingFiles", () => {
  it("finds the file for the default profile", () => {
    const user = path.join("/data", "User")
    expect(userKeybindingFiles(path.join(user, "globalStorage", "kilocode.kilo-code-v2"))).toEqual([
      path.join(user, "keybindings.json"),
    ])
  })

  it("falls back from a profile to the default file", () => {
    const user = path.join("/data", "User")
    expect(userKeybindingFiles(path.join(user, "profiles", "abc", "globalStorage", "kilocode.kilo-code-v2"))).toEqual([
      path.join(user, "profiles", "abc", "keybindings.json"),
      path.join(user, "keybindings.json"),
    ])
  })
})

describe("resolvePromptKeybindings", () => {
  it("labels the cycle commands for the platform", () => {
    expect(resolvePromptKeybindings(defaults, undefined, true)).toEqual({
      cycleAgentMode: "⌘.",
      cyclePreviousAgentMode: "⌘⇧.",
    })
    expect(resolvePromptKeybindings(defaults, undefined, false)).toEqual({
      cycleAgentMode: "Ctrl+.",
      cyclePreviousAgentMode: "Ctrl+Shift+.",
    })
  })

  it("applies the user's override and ignores unrelated commands", () => {
    const user = [
      { key: "cmd+j", command: "kilo-code.v2.cycleAgentMode" },
      { key: "cmd+k", command: "some.other.command" },
    ]
    expect(resolvePromptKeybindings(defaults, user, true)).toEqual({
      cycleAgentMode: "⌘J",
      cyclePreviousAgentMode: "⌘⇧.",
    })
  })

  it("omits a command the user removed", () => {
    const user = [{ key: "cmd+.", command: "-kilo-code.v2.cycleAgentMode" }]
    expect(resolvePromptKeybindings(defaults, user, true).cycleAgentMode).toBeUndefined()
  })
})

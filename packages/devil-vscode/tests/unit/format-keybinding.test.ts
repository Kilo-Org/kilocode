import { describe, it, expect } from "bun:test"
import { formatKeybinding } from "../../src/agent-manager/format-keybinding"

describe("formatKeybinding", () => {
  describe("mac", () => {
    it("formats cmd as ⌘", () => {
      expect(formatKeybinding("cmd+w", true)).toBe("⌘W")
    })

    it("formats cmd+shift as ⌘⇧", () => {
      expect(formatKeybinding("cmd+shift+w", true)).toBe("⌘⇧W")
    })

    it("formats ctrl as ⌃", () => {
      expect(formatKeybinding("ctrl+c", true)).toBe("⌃C")
    })

    it("formats alt as ⌥", () => {
      expect(formatKeybinding("alt+f", true)).toBe("⌥F")
    })

    it("formats arrow keys as symbols", () => {
      expect(formatKeybinding("cmd+left", true)).toBe("⌘←")
      expect(formatKeybinding("cmd+right", true)).toBe("⌘→")
      expect(formatKeybinding("cmd+up", true)).toBe("⌘↑")
      expect(formatKeybinding("cmd+down", true)).toBe("⌘↓")
    })

    it("formats special keys", () => {
      expect(formatKeybinding("cmd+backspace", true)).toBe("⌘⌫")
      expect(formatKeybinding("cmd+enter", true)).toBe("⌘↵")
      expect(formatKeybinding("escape", true)).toBe("Esc")
    })

    it("joins without separator on mac", () => {
      expect(formatKeybinding("cmd+shift+alt+t", true)).toBe("⌘⇧⌥T")
    })

    it("formats plain key", () => {
      expect(formatKeybinding("cmd+/", true)).toBe("⌘/")
    })
  })

  describe("windows/linux", () => {
    it("formats cmd as Ctrl", () => {
      expect(formatKeybinding("cmd+w", false)).toBe("Ctrl+W")
    })

    it("formats ctrl as Ctrl", () => {
      expect(formatKeybinding("ctrl+w", false)).toBe("Ctrl+W")
    })

    it("formats ctrl+shift", () => {
      expect(formatKeybinding("ctrl+shift+w", false)).toBe("Ctrl+Shift+W")
    })

    it("formats alt as Alt", () => {
      expect(formatKeybinding("alt+f", false)).toBe("Alt+F")
    })

    it("formats arrow keys as symbols", () => {
      expect(formatKeybinding("ctrl+left", false)).toBe("Ctrl+←")
      expect(formatKeybinding("ctrl+right", false)).toBe("Ctrl+→")
      expect(formatKeybinding("ctrl+up", false)).toBe("Ctrl+↑")
      expect(formatKeybinding("ctrl+down", false)).toBe("Ctrl+↓")
    })

    it("joins with + separator on non-mac", () => {
      expect(formatKeybinding("ctrl+shift+alt+t", false)).toBe("Ctrl+Shift+Alt+T")
    })
  })
})

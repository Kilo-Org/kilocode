// The Agent Manager shortcuts use Cmd on macOS and Ctrl elsewhere. On macOS a Ctrl chord belongs to the focused
// control: the terminal needs Ctrl+E, Ctrl+W and Ctrl+D, and the composer keeps the native caret keys.
import { describe, expect, it } from "bun:test"
import { blocksBrowserDefault, isFocusChord, leavesTerminal } from "../webview-ui/agent-manager/chords"

const key = (value: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: value,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
})

describe("terminal chords", () => {
  it("sends Ctrl chords to the shell on macOS", () => {
    for (const letter of ["e", "w", "d", "f", "n", "t", "1"]) {
      expect(leavesTerminal(key(letter, { ctrl: true }), true)).toBe(false)
    }
    expect(leavesTerminal(key("/", { ctrl: true }), true)).toBe(false)
    expect(leavesTerminal(key("ArrowLeft", { ctrl: true, alt: true }), true)).toBe(false)
  })

  it("hands the Cmd shortcuts to the Agent Manager on macOS", () => {
    expect(leavesTerminal(key("t", { meta: true }), true)).toBe(true)
    expect(leavesTerminal(key("w", { meta: true }), true)).toBe(true)
    expect(leavesTerminal(key("/", { meta: true }), true)).toBe(true)
    expect(leavesTerminal(key("2", { meta: true }), true)).toBe(true)
    expect(leavesTerminal(key("ArrowUp", { meta: true, alt: true }), true)).toBe(true)
    expect(leavesTerminal(key("[", { meta: true, shift: true }), true)).toBe(true)
  })

  it("keeps the Ctrl shortcuts on other platforms", () => {
    expect(leavesTerminal(key("t", { ctrl: true }), false)).toBe(true)
    expect(leavesTerminal(key("w", { ctrl: true }), false)).toBe(true)
    expect(leavesTerminal(key("/", { ctrl: true }), false)).toBe(true)
  })

  it("never takes Ctrl+C from the shell", () => {
    expect(leavesTerminal(key("c", { ctrl: true }), true)).toBe(false)
    expect(leavesTerminal(key("c", { ctrl: true }), false)).toBe(false)
  })

  it("recognizes the focus shortcut by platform", () => {
    expect(isFocusChord(key("M", { meta: true, shift: true }), true)).toBe(true)
    expect(isFocusChord(key("m", { ctrl: true, shift: true }), true)).toBe(false)
    expect(isFocusChord(key("m", { ctrl: true, shift: true }), false)).toBe(true)
    expect(isFocusChord(key("m", { meta: true, shift: true, alt: true }), true)).toBe(false)
  })
})

describe("browser defaults", () => {
  it("leaves the composer caret keys alone on macOS", () => {
    for (const letter of ["e", "f", "d", "n", "t", "w"]) {
      expect(blocksBrowserDefault(key(letter, { ctrl: true }), true)).toBe(false)
    }
  })

  it("blocks the browser default of the Agent Manager shortcuts", () => {
    expect(blocksBrowserDefault(key("w", { meta: true }), true)).toBe(true)
    expect(blocksBrowserDefault(key("n", { ctrl: true }), false)).toBe(true)
    expect(blocksBrowserDefault(key("O", { meta: true, shift: true }), true)).toBe(true)
    expect(blocksBrowserDefault(key("?", { meta: true, shift: true }), true)).toBe(true)
    expect(blocksBrowserDefault(key("3", { meta: true }), true)).toBe(true)
    expect(blocksBrowserDefault(key("ArrowDown", { meta: true, alt: true }), true)).toBe(true)
  })

  it("keeps copy and paste", () => {
    expect(blocksBrowserDefault(key("c", { meta: true }), true)).toBe(false)
    expect(blocksBrowserDefault(key("v", { ctrl: true }), false)).toBe(false)
  })
})

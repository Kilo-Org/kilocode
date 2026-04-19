/**
 * Parser corpus tests.
 *
 * Tests `parseBinding` indirectly via `KeybindRegistry.matchEvent` to validate
 * that devil-keybind's parser produces byte-compatible results with
 * packages/opencode/src/util/keybind.ts for all committed corpus cases.
 *
 * Strategy: register a command with a specific binding string, then call
 * matchEvent with the expected parsed-key event, and assert the command is found.
 */
import { describe, test, expect, beforeEach } from "bun:test"
import { createCommandRegistry, createKeybindRegistry } from "../src/registry"
import type { Command, CommandRegistry, KeybindRegistry } from "../src/schemas"

let registry: CommandRegistry
let keybinds: KeybindRegistry

function makeCmd(id: string, binding: string): Command {
  return {
    id,
    title: id,
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding, leader: false },
  }
}

beforeEach(() => {
  registry = createCommandRegistry()
  keybinds = createKeybindRegistry(registry)
})

describe("Parser corpus — plain keys", () => {
  test('"a" matches {name:"a", ctrl:false, meta:false, shift:false, leader:false}', () => {
    registry.register(makeCmd("plain-a", "a"))
    const match = keybinds.matchEvent({ name: "a", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(match?.id).toBe("plain-a")
  })

  test('"escape" matches {name:"escape"}', () => {
    registry.register(makeCmd("plain-esc", "escape"))
    const match = keybinds.matchEvent(
      { name: "escape", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("plain-esc")
  })

  test('"space" matches {name:"space"}', () => {
    registry.register(makeCmd("plain-space", "space"))
    const match = keybinds.matchEvent(
      { name: "space", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("plain-space")
  })
})

describe("Parser corpus — modifier combos", () => {
  test('"ctrl+k" matches {ctrl:true, name:"k"}', () => {
    registry.register(makeCmd("ctrl-k", "ctrl+k"))
    const match = keybinds.matchEvent({ name: "k", ctrl: true, meta: false, shift: false, leader: false }, "global")
    expect(match?.id).toBe("ctrl-k")
  })

  test('"alt+shift+p" matches {meta:true, shift:true, name:"p"}', () => {
    registry.register(makeCmd("alt-shift-p", "alt+shift+p"))
    const match = keybinds.matchEvent({ name: "p", ctrl: false, meta: true, shift: true, leader: false }, "global")
    expect(match?.id).toBe("alt-shift-p")
  })

  test('"cmd+enter" (cmd alias for meta) matches {meta:true, name:"enter"}', () => {
    registry.register(makeCmd("cmd-enter", "cmd+enter"))
    const match = keybinds.matchEvent({ name: "enter", ctrl: false, meta: true, shift: false, leader: false }, "global")
    expect(match?.id).toBe("cmd-enter")
  })
})

describe("Parser corpus — multi-combo comma separation", () => {
  test('"ctrl+k,alt+k" — ctrl variant matches', () => {
    registry.register(makeCmd("multi-k", "ctrl+k,alt+k"))
    const ctrlMatch = keybinds.matchEvent({ name: "k", ctrl: true, meta: false, shift: false, leader: false }, "global")
    expect(ctrlMatch?.id).toBe("multi-k")
  })

  test('"ctrl+k,alt+k" — alt variant matches', () => {
    registry.register(makeCmd("multi-k-2", "ctrl+k,alt+k"))
    const altMatch = keybinds.matchEvent({ name: "k", ctrl: false, meta: true, shift: false, leader: false }, "global")
    expect(altMatch?.id).toBe("multi-k-2")
  })

  test('"ctrl+k,alt+k" — non-variant does not match', () => {
    registry.register(makeCmd("multi-k-3", "ctrl+k,alt+k"))
    const noMatch = keybinds.matchEvent({ name: "k", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(noMatch).toBeUndefined()
  })
})

describe("Parser corpus — leader prefix", () => {
  test('"<leader> p" matches {name:"p", leader:true}', () => {
    registry.register(makeCmd("leader-p", "<leader> p"))
    const match = keybinds.matchEvent({ name: "p", ctrl: false, meta: false, shift: false, leader: true }, "global")
    expect(match?.id).toBe("leader-p")
  })

  test('"<leader> p" does NOT match {name:"p", leader:false}', () => {
    registry.register(makeCmd("leader-p-2", "<leader> p"))
    const noMatch = keybinds.matchEvent({ name: "p", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(noMatch).toBeUndefined()
  })
})

describe("Parser corpus — normalised key names", () => {
  test('"esc" binding matches event with name:"escape"', () => {
    // opencode parser normalises "esc" → "escape" at parse time; both should match
    registry.register(makeCmd("esc-cmd", "esc"))
    const match = keybinds.matchEvent(
      { name: "escape", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("esc-cmd")
  })

  test('"escape" binding matches event with name:"esc"', () => {
    registry.register(makeCmd("escape-cmd", "escape"))
    const match = keybinds.matchEvent({ name: "esc", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(match?.id).toBe("escape-cmd")
  })

  test('"del" binding matches event with name:"delete"', () => {
    registry.register(makeCmd("del-cmd", "del"))
    const match = keybinds.matchEvent(
      { name: "delete", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("del-cmd")
  })

  test('"delete" binding matches event with name:"del"', () => {
    registry.register(makeCmd("delete-cmd", "delete"))
    const match = keybinds.matchEvent({ name: "del", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(match?.id).toBe("delete-cmd")
  })

  test('"return" binding matches event with name:"enter"', () => {
    registry.register(makeCmd("return-cmd", "return"))
    const match = keybinds.matchEvent(
      { name: "enter", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("return-cmd")
  })

  test('"enter" binding matches event with name:"return"', () => {
    registry.register(makeCmd("enter-cmd", "enter"))
    const match = keybinds.matchEvent(
      { name: "return", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(match?.id).toBe("enter-cmd")
  })
})

describe("Parser corpus — sentinel 'none'", () => {
  test('"none" binding never matches any key event', () => {
    registry.register(makeCmd("none-cmd", "none"))
    // Try a few different events
    const tryK = keybinds.matchEvent({ name: "k", ctrl: false, meta: false, shift: false, leader: false }, "global")
    expect(tryK).toBeUndefined()

    const tryCtrlK = keybinds.matchEvent({ name: "k", ctrl: true, meta: false, shift: false, leader: false }, "global")
    expect(tryCtrlK).toBeUndefined()

    const tryEscape = keybinds.matchEvent(
      { name: "escape", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(tryEscape).toBeUndefined()
  })
})

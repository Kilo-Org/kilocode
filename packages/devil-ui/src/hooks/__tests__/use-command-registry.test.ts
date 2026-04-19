import { describe, it, expect } from "bun:test"
import { createRoot } from "solid-js"
import { createCommandRegistry, createKeybindRegistry } from "@devilcode/keybind"
import type { Command } from "@devilcode/keybind"
import { withRoot } from "./test-harness"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommand(id: string, title: string): Command {
  return {
    id,
    title,
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createCommandRegistry", () => {
  it("registers commands and returns them via getAllByScope", () => {
    withRoot((dispose) => {
      const registry = createCommandRegistry()
      registry.register(makeCommand("cmd.open", "Open File"))
      registry.register(makeCommand("cmd.save", "Save File"))
      registry.register(makeCommand("cmd.plan", "Plan Project"))

      const entries = registry.getAllByScope("global")
      expect(entries.length).toBeGreaterThanOrEqual(3)
      dispose()
    })
  })

  it("search returns commands matching a fuzzy query", () => {
    withRoot((dispose) => {
      const registry = createCommandRegistry()
      registry.register(makeCommand("cmd.plan", "Plan Project"))
      registry.register(makeCommand("cmd.save", "Save File"))
      registry.register(makeCommand("cmd.open", "Open File"))

      const results = registry.search("pla")
      expect(results.some((c) => c.title.toLowerCase().includes("plan"))).toBe(true)
      dispose()
    })
  })

  it("unregister removes command and entries shrink", () => {
    withRoot((dispose) => {
      const registry = createCommandRegistry()
      registry.register(makeCommand("cmd.alpha", "Alpha"))
      const unregBeta = registry.register(makeCommand("cmd.beta", "Beta"))
      registry.register(makeCommand("cmd.gamma", "Gamma"))

      expect(registry.getAllByScope("global").length).toBe(3)
      unregBeta()
      expect(registry.getAllByScope("global").length).toBe(2)
      expect(registry.get("cmd.beta")).toBeUndefined()
      dispose()
    })
  })

  it("subscribe() callback fires on registration and updates reactive signal", () => {
    withRoot((dispose) => {
      const registry = createCommandRegistry()

      let callCount = 0
      const unsub = registry.subscribe(() => {
        callCount++
      })

      registry.register(makeCommand("cmd.react", "Reactive Command"))
      expect(callCount).toBe(1)

      registry.register(makeCommand("cmd.react2", "Another Command"))
      expect(callCount).toBe(2)

      unsub()
      // After unsubscribe, count should not increment.
      registry.register(makeCommand("cmd.react3", "Third Command"))
      expect(callCount).toBe(2)

      dispose()
    })
  })

  it("onSelect and enabled are accessible after register", () => {
    withRoot((dispose) => {
      const registry = createCommandRegistry()
      const onSelect = () => {}
      const enabled = () => true

      registry.register({
        ...makeCommand("cmd.with-fns", "With Functions"),
        onSelect,
        enabled,
      })

      const cmd = registry.get("cmd.with-fns")
      expect(cmd).toBeDefined()
      expect(cmd?.onSelect).toBe(onSelect)
      expect(cmd?.enabled).toBe(enabled)
      dispose()
    })
  })
})

describe("createKeybindRegistry", () => {
  it("matchEvent returns command matching keybind in scope", () => {
    withRoot((dispose) => {
      const commands = createCommandRegistry()
      const keybinds = createKeybindRegistry(commands)

      commands.register({
        ...makeCommand("cmd.ctrl-p", "Command Palette"),
        keybind: { binding: "ctrl+p", leader: false },
      })

      const match = keybinds.matchEvent({ name: "p", ctrl: true, meta: false, shift: false, leader: false }, "global")
      expect(match).toBeDefined()
      expect(match?.id).toBe("cmd.ctrl-p")
      dispose()
    })
  })
})

describe("subscribe-path reactive integration", () => {
  it("entries signal updates after register via subscribe()", () => {
    createRoot((dispose) => {
      const { createSignal, onCleanup } = require("solid-js") as typeof import("solid-js")

      const registry = createCommandRegistry()
      const [entries, setEntries] = createSignal<Command[]>(registry.getAllByScope("global"))
      const unsub = registry.subscribe(() => setEntries([...registry.getAllByScope("global")]))
      onCleanup(unsub)

      expect(entries().length).toBe(0)
      registry.register(makeCommand("cmd.subscribe-test", "Subscribe Test"))
      expect(entries().length).toBe(1)
      expect(entries()[0].id).toBe("cmd.subscribe-test")

      dispose()
    })
  })
})

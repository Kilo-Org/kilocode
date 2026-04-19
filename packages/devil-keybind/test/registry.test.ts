import { describe, test, expect, beforeEach } from "bun:test"
import { createCommandRegistry, createKeybindRegistry } from "../src/registry"
import type { Command, CommandRegistry } from "../src/schemas"

// Helper to build a minimal valid command
function makeCmd(id: string, overrides: Partial<Command> = {}): Command {
  return {
    id,
    title: id.charAt(0).toUpperCase() + id.slice(1),
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    ...overrides,
  }
}

describe("CommandRegistry", () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = createCommandRegistry()
  })

  test("register returns an unregister function that removes only this command", () => {
    const unregisterA = registry.register(makeCmd("cmd-a"))
    registry.register(makeCmd("cmd-b"))

    unregisterA()

    const result = registry.getAllByScope("workflow")
    expect(result.some((c) => c.id === "cmd-a")).toBe(false)
    expect(result.some((c) => c.id === "cmd-b")).toBe(true)
  })

  test("register throws on duplicate id", () => {
    registry.register(makeCmd("dup"))
    expect(() => registry.register(makeCmd("dup"))).toThrow('Command with id "dup" is already registered')
  })

  test("register validates via Zod — empty id throws", () => {
    expect(() => registry.register(makeCmd("", { id: "" }))).toThrow()
  })

  test("register validates via Zod — empty title throws", () => {
    expect(() =>
      registry.register({
        id: "ok-id",
        title: "",
        scope: "global",
        aliases: [],
        hideKeywords: [],
        hidden: false,
      }),
    ).toThrow()
  })

  test("getAllByScope returns scope + global, excluding hidden", () => {
    registry.register(makeCmd("global-cmd", { scope: "global" }))
    registry.register(makeCmd("workflow-cmd", { scope: "workflow" }))
    registry.register(makeCmd("hidden-workflow", { scope: "workflow", hidden: true }))

    const result = registry.getAllByScope("workflow")

    expect(result.some((c) => c.id === "global-cmd")).toBe(true)
    expect(result.some((c) => c.id === "workflow-cmd")).toBe(true)
    expect(result.some((c) => c.id === "hidden-workflow")).toBe(false)
  })

  test("getAllByScope excludes other scopes", () => {
    registry.register(makeCmd("team-cmd", { scope: "team-builder" }))
    const result = registry.getAllByScope("workflow")
    expect(result.some((c) => c.id === "team-cmd")).toBe(false)
  })

  test("search delegates to matcher and returns plan command first", () => {
    registry.register(makeCmd("plan-cmd", { title: "Plan Phase", scope: "workflow" }))
    registry.register(makeCmd("review-cmd", { title: "Review Changes", scope: "workflow" }))
    registry.register(makeCmd("other-cmd", { title: "Navigate Files", scope: "workflow" }))

    const results = registry.search("pla")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe("plan-cmd")
  })

  test("KeybindRegistry.matchEvent matches binding + scope", () => {
    const keybindRegistry = createKeybindRegistry(registry)
    registry.register(
      makeCmd("global-k", {
        scope: "global",
        keybind: { binding: "ctrl+k", leader: false },
      }),
    )

    const match = keybindRegistry.matchEvent(
      { name: "k", ctrl: true, meta: false, shift: false, leader: false },
      "workflow",
    )

    expect(match).toBeDefined()
    expect(match?.id).toBe("global-k")
  })

  test("KeybindRegistry.matchEvent respects leader flag", () => {
    const keybindRegistry = createKeybindRegistry(registry)
    registry.register(
      makeCmd("leader-p", {
        scope: "global",
        keybind: { binding: "<leader> p", leader: true },
      }),
    )

    const noLeader = keybindRegistry.matchEvent(
      { name: "p", ctrl: false, meta: false, shift: false, leader: false },
      "global",
    )
    expect(noLeader).toBeUndefined()

    const withLeader = keybindRegistry.matchEvent(
      { name: "p", ctrl: false, meta: false, shift: false, leader: true },
      "global",
    )
    expect(withLeader).toBeDefined()
    expect(withLeader?.id).toBe("leader-p")
  })

  test("subscribe fires on register and unregister", () => {
    let callCount = 0
    const dispose = registry.subscribe(() => {
      callCount++
    })

    // First registration fires once
    const unregCmd = registry.register(makeCmd("sub-test"))
    expect(callCount).toBe(1)

    // Unregister fires again
    unregCmd()
    expect(callCount).toBe(2)

    // Disposing the subscription means further mutations don't fire
    dispose()
    registry.register(makeCmd("sub-test-2"))
    expect(callCount).toBe(2)
  })

  test("onSelect and enabled accepted as TS-only fields without throwing", () => {
    const onSelect = () => {}
    const enabled = () => true

    expect(() =>
      registry.register({
        ...makeCmd("func-cmd"),
        onSelect,
        enabled,
      }),
    ).not.toThrow()

    const cmd = registry.get("func-cmd")
    expect(cmd).toBeDefined()
    expect(typeof cmd?.onSelect).toBe("function")
    expect(typeof cmd?.enabled).toBe("function")
  })

  test("get returns registered command by id", () => {
    registry.register(makeCmd("findme"))
    expect(registry.get("findme")).toBeDefined()
    expect(registry.get("missing")).toBeUndefined()
  })
})

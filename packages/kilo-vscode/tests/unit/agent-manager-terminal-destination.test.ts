import { describe, expect, it } from "bun:test"
import {
  DestinationState,
  affectsTerminalDestination,
  resolveTerminalDestination,
} from "../../src/agent-manager/terminal-destination"

function event(key: string) {
  return {
    affectsConfiguration: (target: string) => target === key,
  } as Parameters<typeof affectsTerminalDestination>[0]
}

describe("Agent Manager terminal destination", () => {
  it("defaults unset settings to the Agent Manager panel", () => {
    expect(resolveTerminalDestination(undefined)).toBe("agentManager")
  })

  it("preserves explicit destinations and falls back safely for invalid settings", () => {
    expect(resolveTerminalDestination("invalid")).toBe("vscode")
    expect(resolveTerminalDestination("vscode")).toBe("vscode")
    expect(resolveTerminalDestination("agentManager")).toBe("agentManager")
  })

  it("watches only the terminal button destination setting", () => {
    expect(affectsTerminalDestination(event("kilo-code.new.agentManager.terminalButtonDestination"))).toBe(true)
    expect(affectsTerminalDestination(event("terminal.integrated.fontFamily"))).toBe(false)
  })

  it.each(["vscode", "agentManager"] as const)(
    "lets a panel-local %s choice beat later setting echoes",
    (destination) => {
      const state = new DestinationState("agentManager")
      const other = destination === "vscode" ? "agentManager" : "vscode"
      state.sync(other)
      expect(state.value()).toBe(other)
      state.select(destination)
      state.sync(other)
      expect(state.value()).toBe(destination)
    },
  )
})

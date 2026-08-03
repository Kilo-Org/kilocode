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
  it("defaults unknown settings to the VS Code terminal", () => {
    expect(resolveTerminalDestination(undefined)).toBe("vscode")
    expect(resolveTerminalDestination("invalid")).toBe("vscode")
    expect(resolveTerminalDestination("vscode")).toBe("vscode")
    expect(resolveTerminalDestination("agentManager")).toBe("agentManager")
  })

  it("watches only the terminal button destination setting", () => {
    expect(affectsTerminalDestination(event("kilo-code.new.agentManager.terminalButtonDestination"))).toBe(true)
    expect(affectsTerminalDestination(event("terminal.integrated.fontFamily"))).toBe(false)
  })

  it("lets a panel-local choice beat later setting echoes", () => {
    const state = new DestinationState("vscode")
    state.sync("agentManager")
    expect(state.value()).toBe("agentManager")
    state.select("agentManager")
    state.sync("vscode")
    expect(state.value()).toBe("agentManager")
  })
})

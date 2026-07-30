import { describe, expect, it } from "bun:test"
import type { StartTask } from "../../src/agent-manager/run/controller"
import { pickRunStart, resolveRunTerminalDestination } from "../../src/agent-manager/run/destination"

describe("Run terminal destination", () => {
  it("defaults unknown settings to the embedded Agent Manager terminal", () => {
    expect(resolveRunTerminalDestination(undefined)).toBe("agentManager")
    expect(resolveRunTerminalDestination("invalid")).toBe("agentManager")
    expect(resolveRunTerminalDestination("agentManager")).toBe("agentManager")
    expect(resolveRunTerminalDestination("vscode")).toBe("vscode")
  })

  it("picks the adapter matching the destination", () => {
    const handle = { stop: () => undefined, dispose: () => undefined }
    const embedded: StartTask = async () => handle
    const integrated: StartTask = async () => handle

    expect(pickRunStart("agentManager", embedded, integrated)).toBe(embedded)
    expect(pickRunStart("vscode", embedded, integrated)).toBe(integrated)
  })
})

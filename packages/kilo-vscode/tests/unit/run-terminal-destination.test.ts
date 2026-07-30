import { describe, expect, it } from "bun:test"
import type { StartTask } from "../../src/agent-manager/run/controller"
import { pickRunStart } from "../../src/agent-manager/run/destination"

describe("Run terminal destination", () => {
  it("picks the adapter matching the panel dropdown destination", () => {
    const handle = { stop: () => undefined, dispose: () => undefined }
    const embedded: StartTask = async () => handle
    const integrated: StartTask = async () => handle

    expect(pickRunStart("agentManager", embedded, integrated)).toBe(embedded)
    expect(pickRunStart("vscode", embedded, integrated)).toBe(integrated)
  })
})

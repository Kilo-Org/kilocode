import { describe, expect, it, mock } from "bun:test"
import type { RunController } from "../../src/agent-manager/run/controller"
import { handleRunMessage } from "../../src/agent-manager/run/message"
import type { AgentManagerInMessage } from "../../src/agent-manager/types"

function controller() {
  const run = mock(() => Promise.resolve())
  const stop = mock(() => undefined)
  const configure = mock(() => Promise.resolve())
  return {
    value: { run, stop, configure } as unknown as RunController,
    run,
    stop,
    configure,
  }
}

describe("Agent Manager Run messages", () => {
  it.each(["agentManager", "vscode"] as const)("forwards the %s dropdown destination", (destination) => {
    const item = controller()
    const msg = {
      type: "agentManager.runScript",
      worktreeId: "wt-1",
      destination,
    } satisfies AgentManagerInMessage

    expect(handleRunMessage(item.value, msg)).toBe(true)
    expect(item.run).toHaveBeenCalledWith("wt-1", destination)
  })
})

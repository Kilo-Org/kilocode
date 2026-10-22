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

  it("applies the project qualifier to the shared local key", () => {
    const item = controller()
    const qualify = (id: string) => (id === "local" ? "prj-a:local" : id)

    expect(
      handleRunMessage(
        item.value,
        { type: "agentManager.runScript", worktreeId: "local", destination: "vscode" } as AgentManagerInMessage,
        qualify,
      ),
    ).toBe(true)
    expect(item.run).toHaveBeenCalledWith("prj-a:local", "vscode")

    expect(
      handleRunMessage(
        item.value,
        { type: "agentManager.stopRunScript", worktreeId: "local" } as AgentManagerInMessage,
        qualify,
      ),
    ).toBe(true)
    expect(item.stop).toHaveBeenCalledWith("prj-a:local")
  })

  it("leaves worktree ids unqualified and works without a qualifier", () => {
    const item = controller()
    const qualify = (id: string) => (id === "local" ? `${id}:qualified` : id)

    expect(
      handleRunMessage(
        item.value,
        { type: "agentManager.runScript", worktreeId: "wt-1", destination: "vscode" } as AgentManagerInMessage,
        qualify,
      ),
    ).toBe(true)
    expect(item.run).toHaveBeenCalledWith("wt-1", "vscode")

    expect(
      handleRunMessage(item.value, {
        type: "agentManager.stopRunScript",
        worktreeId: "local",
      } as AgentManagerInMessage),
    ).toBe(true)
    expect(item.stop).toHaveBeenCalledWith("local")
  })
})

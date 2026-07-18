import { describe, expect, it } from "bun:test"
import { WorktreeImporter, type WorktreeImporterHost } from "../../src/agent-manager/worktree-importer"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

function host(messages: AgentManagerOutMessage[], managers: Record<string, unknown>): WorktreeImporterHost {
  return {
    manager: (projectId) => managers[projectId ?? "legacy"] as never,
    state: () => undefined,
    post: (message) => messages.push(message),
    push: () => undefined,
    setup: async () => undefined,
    session: async () => null,
    register: () => undefined,
    ready: () => undefined,
    log: () => undefined,
  }
}

describe("WorktreeImporter project routing", () => {
  it("lists branches through the requested project manager", async () => {
    const messages: AgentManagerOutMessage[] = []
    const calls: Array<string | undefined> = []
    const states: Array<string | undefined> = []
    const manager = {
      listBranches: async () => ({
        branches: [{ name: "backend", isLocal: true, isRemote: false, isDefault: true }],
        defaultBranch: "backend",
      }),
      checkedOutBranches: async () => new Set<string>(),
    }
    const routed = host(messages, { backend: manager })
    const original = routed.manager
    const originalState = routed.state
    routed.manager = (projectId) => {
      calls.push(projectId)
      return original(projectId)
    }
    routed.state = (projectId) => {
      states.push(projectId)
      return originalState(projectId)
    }
    const importer = new WorktreeImporter(routed)

    await importer.branches("backend")

    expect(calls).toEqual(["backend"])
    expect(states).toEqual(["backend"])
    expect(messages).toEqual([
      {
        type: "agentManager.branches",
        projectId: "backend",
        branches: [{ name: "backend", isLocal: true, isRemote: false, isDefault: true, isCheckedOut: false }],
        defaultBranch: "backend",
      },
    ])
  })

  it("returns a project-scoped empty result when the project is unavailable", async () => {
    const messages: AgentManagerOutMessage[] = []
    await new WorktreeImporter(host(messages, {})).branches("missing")

    expect(messages).toEqual([
      { type: "agentManager.branches", projectId: "missing", branches: [], defaultBranch: "main" },
    ])
  })
})

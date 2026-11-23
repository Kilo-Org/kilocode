import { describe, expect, it, mock } from "bun:test"
import { AgentManagerProvider } from "../../src/agent-manager/AgentManagerProvider"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import type { RunStatus } from "../../src/agent-manager/run/manager"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

type Internals = {
  run: { state: () => { runStatuses: RunStatus[]; runScriptConfigured: boolean } }
  contexts: {
    resolve: (id: string) => { id: string } | undefined
    byWorktree: (id: string) => { id: string } | undefined
  }
  postToWebview: (message: AgentManagerOutMessage) => void
  runStateFor: (ctx: ProjectContext) => { runStatuses: RunStatus[] }
  runKey: (id: string) => string
  postRunMessage: (message: AgentManagerOutMessage) => void
}

function ctx(id: string, pinned: boolean, worktreeIds: string[]): ProjectContext {
  return {
    id,
    pinned,
    peekState: () => ({ getWorktrees: () => worktreeIds.map((wt) => ({ id: wt })) }),
  } as unknown as ProjectContext
}

function provider(runStatuses: RunStatus[]) {
  const instance = Object.create(AgentManagerProvider.prototype) as Internals
  instance.run = { state: () => ({ runStatuses, runScriptConfigured: true }) }
  return instance
}

describe("Agent Manager run status project scoping", () => {
  it("filters the state payload to the target project and un-namespaces its local key", () => {
    const instance = provider([
      { worktreeId: "wt-a1", state: "running" },
      { worktreeId: "prj-a:local", state: "running" },
      { worktreeId: "wt-b1", state: "running" },
      { worktreeId: "prj-b:local", state: "stopping" },
    ])

    const a = instance.runStateFor(ctx("prj-a", false, ["wt-a1"]))
    expect(a.runStatuses).toEqual([
      { worktreeId: "wt-a1", state: "running" },
      { worktreeId: "local", state: "running" },
    ])

    const b = instance.runStateFor(ctx("prj-b", false, ["wt-b1"]))
    expect(b.runStatuses).toEqual([
      { worktreeId: "wt-b1", state: "running" },
      { worktreeId: "local", state: "stopping" },
    ])
  })

  it("does not assign unqualified local entries to a project", () => {
    const instance = provider([{ worktreeId: "local", state: "running" }])

    expect(instance.runStateFor(ctx("prj-pinned", true, [])).runStatuses).toEqual([])
    expect(instance.runStateFor(ctx("prj-other", false, [])).runStatuses).toEqual([])
  })

  it("qualifies local run keys for every project and tolerates no active project", () => {
    const instance = provider([])
    for (const id of ["prj-pinned", "prj-other", undefined]) {
      Object.defineProperty(instance, "context", { configurable: true, value: id ? { id } : undefined })
      expect(instance.runKey("local")).toBe(id ? `${id}:local` : "local")
      expect(instance.runKey("wt-a1")).toBe("wt-a1")
    }
  })

  it("stamps the owning project on emissions and un-namespaces qualified local keys", () => {
    const instance = provider([])
    const posted: AgentManagerOutMessage[] = []
    instance.contexts = {
      resolve: (id) => (id === "prj-a" ? { id: "prj-a" } : undefined),
      byWorktree: (id) => (id === "wt-a1" ? { id: "prj-a" } : undefined),
    }
    instance.postToWebview = mock((message: AgentManagerOutMessage) => void posted.push(message))

    instance.postRunMessage({ type: "agentManager.runStatus", worktreeId: "prj-a:local", state: "running" })
    instance.postRunMessage({ type: "agentManager.runStatus", worktreeId: "wt-a1", state: "running" })
    instance.postRunMessage({ type: "agentManager.runStatus", worktreeId: "local", state: "running" })

    expect(posted).toEqual([
      { type: "agentManager.runStatus", worktreeId: "local", state: "running", projectId: "prj-a" },
      { type: "agentManager.runStatus", worktreeId: "wt-a1", state: "running", projectId: "prj-a" },
      { type: "agentManager.runStatus", worktreeId: "local", state: "running" },
    ])
  })

  it("passes non-runStatus messages through untouched", () => {
    const instance = provider([])
    const posted: AgentManagerOutMessage[] = []
    instance.postToWebview = mock((message: AgentManagerOutMessage) => void posted.push(message))

    instance.postRunMessage({ type: "agentManager.localStats", stats: undefined } as never)
    expect(posted).toEqual([{ type: "agentManager.localStats", stats: undefined }])
  })
})

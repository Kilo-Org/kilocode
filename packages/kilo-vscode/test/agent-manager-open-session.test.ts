import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SessionInfo } from "@opencode/client"
import { ProjectContexts } from "../src/agent-manager/project/contexts"
import { handleProjectMessage, type ProjectMessageDeps } from "../src/agent-manager/project/messages"
import type { SidebarTarget } from "../src/agent-manager/project/route"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import type { AgentManagerInMessage } from "../src/agent-manager/types"

function info(id: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "prj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory },
  }
}

describe("Agent Manager opening an existing session", () => {
  let root: string
  let worktree: string
  let state: WorktreeStateManager
  let contexts: ProjectContexts
  let projectId: string
  let worktreeId: string
  let calls: {
    activate: string[]
    expand: string[]
    push: number
    pushState: number
    error: string[]
    selected: SidebarTarget[]
    ready: string[]
  }
  let deps: ProjectMessageDeps

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-open-session-"))
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    fs.mkdirSync(path.join(root, ".kilo2"), { recursive: true })
    state = new WorktreeStateManager(root, () => undefined)
    worktreeId = state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" }).id
    const registry = { list: () => [], get: () => undefined }
    contexts = new ProjectContexts({
      workspaceRoot: () => root,
      registry: registry as never,
      deps: { log: () => undefined, exists: () => true, state: () => state },
    })
    const ctx = contexts.pinned()!
    projectId = ctx.id
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    calls = { activate: [], expand: [], push: 0, pushState: 0, error: [], selected: [], ready: [] }
    deps = {
      registry: registry as never,
      contexts,
      pickFolder: async () => undefined,
      onboarding: {
        input: async () => undefined,
        confirm: async () => false,
        cloneRepository: async () => undefined,
        isTrusted: () => true,
        notify: () => {},
      },
      activate: (context) => calls.activate.push(context.id),
      expand: (context) => calls.expand.push(context.id),
      push: () => calls.push++,
      pushState: () => calls.pushState++,
      error: (message) => calls.error.push(message),
      ready: async (context) => {
        calls.ready.push(context.id)
        return context.ensureReady(async () => {
          context.stateManager()
          return { ok: true, refsFixed: 0 }
        })
      },
      selected: (target) => calls.selected.push(target),
      post: () => {},
      openSettings: () => {},
      log: () => {},
    }
  })

  afterEach(async () => {
    await state.flush()
    await contexts.dispose()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("files a closed worktree session where it runs when the sidebar search selects it", async () => {
    const ctx = contexts.pinned()!
    ctx.setSessions([{ ...info("live", worktree), worktreeId: worktreeId }])

    await handleProjectMessage(
      {
        type: "agentManager.activateSelection",
        target: { projectId, kind: "session", sessionId: "live" },
      } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("live")?.worktreeId).toBe(worktreeId)
    expect(calls.pushState).toBe(1)
    expect(calls.selected).toEqual([{ projectId, kind: "session", sessionId: "live" }])
    expect(calls.error).toEqual([])
  })

  it("opens a session named by a chat link in its own worktree", async () => {
    deps.sessionDirectory = async () => worktree

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "linked" } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("linked")?.worktreeId).toBe(worktreeId)
    expect(calls.pushState).toBe(1)
    expect(calls.selected).toEqual([{ projectId, kind: "session", sessionId: "linked" }])
    expect(calls.error).toEqual([])
  })

  it("files a session that runs in the project root under Local", async () => {
    deps.sessionDirectory = async () => contexts.pinned()!.root

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "root-run" } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("root-run")?.worktreeId).toBeNull()
    expect(calls.selected).toEqual([{ projectId, kind: "session", sessionId: "root-run" }])
    expect(calls.error).toEqual([])
  })

  it("does not file a session that runs outside the project", async () => {
    const outside = path.join(root, "elsewhere")
    fs.mkdirSync(outside)
    deps.sessionDirectory = async () => outside

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "outside" } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("outside")).toBeUndefined()
    expect(calls.selected).toEqual([])
    expect(calls.error).toEqual([])
  })
})

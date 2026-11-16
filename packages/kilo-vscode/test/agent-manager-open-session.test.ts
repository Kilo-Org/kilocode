import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SessionInfo } from "@opencode/client"
import { ProjectContexts } from "../src/agent-manager/project/contexts"
import { handleProjectMessage, type ProjectMessageDeps } from "../src/agent-manager/project/messages"
import { canonicalizePath, projectIdFor } from "../src/agent-manager/project/paths"
import type { StoredProject } from "../src/agent-manager/project/registry"
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
  let roots: string[]
  let root: string
  let worktree: string
  let state: WorktreeStateManager
  let contexts: ProjectContexts
  let projects: StoredProject[]
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

  beforeEach(() => {
    roots = []
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-open-session-"))
    roots.push(root)
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    fs.mkdirSync(path.join(root, ".kilo2"), { recursive: true })
    projects = []
    const registry = {
      list: () => projects,
      get: (id: string) => projects.find((project) => project.id === id),
    }
    const states = new Map<string, WorktreeStateManager>()
    contexts = new ProjectContexts({
      workspaceRoot: () => root,
      registry: registry as never,
      deps: {
        log: () => undefined,
        exists: () => true,
        state: (stateRoot) => {
          const found = states.get(stateRoot)
          if (found) return found
          const next = new WorktreeStateManager(stateRoot, () => undefined)
          states.set(stateRoot, next)
          return next
        },
      },
    })
    const ctx = contexts.pinned()!
    projectId = ctx.id
    state = ctx.stateManager()
    worktreeId = state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" }).id
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
    await contexts.dispose()
    for (const item of roots) fs.rmSync(item, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  async function readyProject() {
    await contexts.pinned()!.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
  }

  async function addProject(): Promise<{ id: string; worktree: string; state: WorktreeStateManager }> {
    const extraRoot = fs.mkdtempSync(path.join(os.tmpdir(), "am-open-session-extra-"))
    roots.push(extraRoot)
    const extraWorktree = path.join(extraRoot, "wt")
    fs.mkdirSync(extraWorktree)
    const id = projectIdFor(canonicalizePath(extraRoot))
    projects.push({ id, root: extraRoot, order: 2, addedAt: new Date().toISOString() })
    const ctx = contexts.expand(id)!
    const extraState = ctx.stateManager()
    extraState.addWorktree({ branch: "two", path: extraWorktree, parentBranch: "main" })
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    return { id, worktree: extraWorktree, state: extraState }
  }

  it("files a closed worktree session where it runs when the sidebar search selects it", async () => {
    await readyProject()
    contexts.pinned()!.setSessions([{ ...info("live", worktree), worktreeId: worktreeId }])

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
    await readyProject()
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
    await readyProject()
    deps.sessionDirectory = async () => contexts.pinned()!.root

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "root-run" } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("root-run")?.worktreeId).toBeNull()
    expect(calls.selected).toEqual([{ projectId, kind: "session", sessionId: "root-run" }])
    expect(calls.error).toEqual([])
  })

  it("opens a session in the project that owns its server directory", async () => {
    await readyProject()
    const extra = await addProject()
    deps.sessionDirectory = async () => extra.worktree

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "cross-project" } as AgentManagerInMessage,
      deps,
    )

    expect(extra.state.getSession("cross-project")?.worktreeId).toBe(extra.state.getWorktrees()[0]?.id)
    expect(calls.activate).toEqual([extra.id])
    expect(calls.selected).toEqual([{ projectId: extra.id, kind: "session", sessionId: "cross-project" }])
  })

  it("falls back to the project whose live catalog lists the session", async () => {
    await readyProject()
    const extra = await addProject()
    contexts.get(extra.id)!.setSessions([
      { ...info("listed", extra.worktree), worktreeId: extra.state.getWorktrees()[0]!.id },
    ])
    deps.sessionDirectory = async () => undefined

    await handleProjectMessage({ type: "agentManager.openSession", sessionId: "listed" } as AgentManagerInMessage, deps)

    expect(extra.state.getSession("listed")?.worktreeId).toBe(extra.state.getWorktrees()[0]?.id)
    expect(calls.selected).toEqual([{ projectId: extra.id, kind: "session", sessionId: "listed" }])
  })

  it("ignores a chat link that resolves after a newer selection", async () => {
    await readyProject()
    const gate = Promise.withResolvers<string | undefined>()
    deps.sessionDirectory = () => gate.promise

    const late = handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "late" } as AgentManagerInMessage,
      deps,
    )
    await handleProjectMessage(
      {
        type: "agentManager.activateSelection",
        target: { projectId, kind: "worktree", worktreeId },
      } as AgentManagerInMessage,
      deps,
    )
    expect(calls.selected).toEqual([{ projectId, kind: "worktree", worktreeId }])

    gate.resolve(worktree)
    await late

    expect(state.getSession("late")).toBeUndefined()
    expect(calls.selected).toEqual([{ projectId, kind: "worktree", worktreeId }])
  })

  it("does not file a session that runs outside the project", async () => {
    await readyProject()
    const outside = path.join(root, "elsewhere")
    fs.mkdirSync(outside)
    state.addSession("outside", null)
    deps.sessionDirectory = async () => outside

    await handleProjectMessage(
      { type: "agentManager.openSession", sessionId: "outside" } as AgentManagerInMessage,
      deps,
    )

    expect(state.getSession("outside")?.worktreeId).toBeNull()
    expect(calls.pushState).toBe(0)
    expect(calls.selected).toEqual([])
    expect(calls.error).toEqual([])
  })
})

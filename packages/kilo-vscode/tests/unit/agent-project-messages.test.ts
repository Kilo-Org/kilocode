import { describe, it, expect } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { execFileSync } from "child_process"
import { GitOps } from "../../src/agent-manager/GitOps"
import { handleProjectMessage, type ProjectMessageDeps } from "../../src/agent-manager/project/messages"
import { ProjectRegistry, type RegistryStorage } from "../../src/agent-manager/project/registry"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { projectIdFor } from "../../src/agent-manager/project/paths"
import type { AgentManagerInMessage } from "../../src/agent-manager/types"

const WORKSPACE = "/repo/main"

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-am-msg-"))
  execFileSync("git", ["init", "-q", dir])
  return fs.realpathSync(dir)
}

function setup(opts: { workspace?: string | null; git?: GitOps } = {}) {
  let stored: unknown
  let pickResult: string | undefined
  const storage: RegistryStorage = {
    read: () => stored,
    write: (value) => {
      stored = value
    },
  }
  const registry = new ProjectRegistry(storage)
  const contexts = new ProjectContexts({
    workspaceRoot: () => (opts.workspace === null ? undefined : (opts.workspace ?? WORKSPACE)),
    registry,
    deps: { log: () => {}, exists: (dir) => fs.existsSync(dir) },
  })
  const calls = {
    activate: [] as string[],
    expand: [] as string[],
    push: 0,
    empty: 0,
    error: [] as string[],
    pick: 0,
    ready: [] as string[],
    readyResult: { ok: true, refsFixed: 0, current: true } as { ok: boolean; refsFixed: number; current: boolean },
  }
  const deps: ProjectMessageDeps = {
    registry,
    contexts,
    pickFolder: async () => {
      calls.pick++
      return pickResult
    },
    activate: (ctx) => calls.activate.push(ctx.id),
    empty: () => calls.empty++,
    expand: (ctx) => calls.expand.push(ctx.id),
    push: () => calls.push++,
    error: (message) => calls.error.push(message),
    ready: async (ctx) => {
      calls.ready.push(ctx.id)
      return calls.readyResult
    },
    git: opts.git,
    log: () => {},
  }
  const pick = (dir: string | undefined) => {
    pickResult = dir
  }
  return { registry, contexts, deps, calls, pick, storage }
}

function msg(type: string, extra: Record<string, unknown> = {}): AgentManagerInMessage {
  return { type, ...extra } as unknown as AgentManagerInMessage
}

describe("handleProjectMessage", () => {
  it("ignores non-project messages", async () => {
    const { deps } = setup()
    expect(await handleProjectMessage(msg("agentManager.createWorktree"), deps)).toBe(false)
  })

  it("pushes the catalog on requestProjects", async () => {
    const { deps, calls, pick } = setup()
    expect(await handleProjectMessage(msg("agentManager.requestProjects"), deps)).toBe(true)
    expect(calls.push).toBe(1)
  })

  it("rejects unknown project selection and expansion", async () => {
    const { deps, calls, registry, contexts } = setup()
    for (const m of [
      msg("agentManager.selectProject", { projectId: "prj-x" }),
      msg("agentManager.setProjectExpanded", { projectId: "prj-x", expanded: true }),
    ]) {
      await handleProjectMessage(m, deps)
    }
    expect(calls.pick).toBe(0)
    expect(calls.activate).toEqual([])
    expect(calls.expand).toEqual([])
    expect(calls.error).toEqual(["The project is unavailable. Check that the repository still exists."])
    expect(registry.list()).toEqual([])
    expect(contexts.active()?.root).toBe(WORKSPACE)
  })

  it("adds a picked git repository to the registry", async () => {
    const repo = gitRepo()
    const { deps, registry, calls, pick } = setup()
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    const id = projectIdFor(repo)
    const project = registry.get(id)
    expect(project?.root).toBe(repo)
    expect(calls.push).toBe(1)
    expect(calls.error).toEqual([])
  })

  it("rejects folders outside a git repository", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-am-nogit-"))
    const { deps, calls, registry, pick } = setup()
    pick(dir)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(registry.list()).toEqual([])
    expect(calls.error).toEqual(["The selected folder is not inside a Git repository."])
  })

  it("uses the configured Git executable when adding a project", async () => {
    const repo = gitRepo()
    const git = new GitOps({ log: () => {}, binary: path.join(repo, "missing-git") })
    const { deps, calls, registry, pick } = setup({ git })
    pick(repo)

    await handleProjectMessage(msg("agentManager.addProject"), deps)
    git.dispose()

    expect(registry.list()).toEqual([])
    expect(calls.error).toEqual(["The selected folder is not inside a Git repository."])
  })

  it("rejects the pinned workspace repository", async () => {
    const repo = gitRepo()
    const { deps, calls, pick } = setup({ workspace: repo })
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(calls.error).toEqual(["That repository is already the workspace project."])
  })

  it("rejects duplicate registration", async () => {
    const repo = gitRepo()
    const { deps, calls, pick } = setup()
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(calls.error).toEqual(["That repository is already registered as a project."])
  })

  it("does nothing when the picker is cancelled", async () => {
    const { deps, calls, registry, pick } = setup()
    pick(undefined)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(registry.list()).toEqual([])
    expect(calls.push).toBe(0)
  })

  it("selects a registered project without a separate trust step", async () => {
    const repo = gitRepo()
    const { deps, registry, calls, pick } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.selectProject", { projectId: id }), deps)
    expect(calls.activate).toEqual([id])
  })

  it("initializes projects on expand", async () => {
    const repo = gitRepo()
    const { deps, registry, calls } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: true }), deps)
    expect(calls.expand).toEqual([id])
    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: false }), deps)
    expect(calls.expand).toEqual([id])
  })

  it("persists project expansion state across registry instances", async () => {
    const repo = gitRepo()
    const { deps, registry, storage, calls } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: true }), deps)

    const restored = new ProjectRegistry(storage)
    expect(restored.expanded(id)).toBe(true)
    expect(restored.get(id)?.expanded).toBe(true)

    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: false }), deps)

    expect(new ProjectRegistry(storage).expanded(id)).toBe(false)
    expect(calls.push).toBe(2)
  })

  it("persists the pinned project expansion state without adding it to the catalog", async () => {
    const { deps, registry, storage } = setup()
    const id = projectIdFor(WORKSPACE)

    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: false }), deps)

    const restored = new ProjectRegistry(storage)
    expect(restored.expanded(id)).toBe(false)
    expect(registry.list()).toEqual([])
  })

  it("does not initialize missing projects on expand", async () => {
    const repo = gitRepo()
    const { deps, registry, calls } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.setProjectExpanded", { projectId: id, expanded: true }), deps)
    expect(calls.expand).toEqual([id])
  })

  it("activates the pinned fallback when removing the active project", async () => {
    const repo = gitRepo()
    const { deps, registry, contexts, calls } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.selectProject", { projectId: id }), deps)
    await handleProjectMessage(msg("agentManager.removeProject", { projectId: id }), deps)
    expect(registry.get(id)).toBeUndefined()
    expect(contexts.get(id)).toBeUndefined()
    expect(contexts.active()?.root).toBe(WORKSPACE)
    expect(calls.activate).toEqual([id, projectIdFor(WORKSPACE)])
  })

  it("clears applied state after removing the last project without a workspace", async () => {
    const { deps, registry, contexts, calls } = setup({ workspace: null })
    await registry.add({ id: "extra", root: "/extra" })
    contexts.activate("extra")
    await handleProjectMessage(msg("agentManager.removeProject", { projectId: "extra" }), deps)
    expect(contexts.active()).toBeUndefined()
    expect(calls.empty).toBe(1)
  })

  it("does not reactivate the foreground when removing a background project", async () => {
    const { deps, registry, contexts, calls } = setup()
    await registry.add({ id: "extra", root: "/extra" })
    contexts.resolve("extra")
    await handleProjectMessage(msg("agentManager.removeProject", { projectId: "extra" }), deps)
    expect(calls.activate).toEqual([])
    expect(calls.empty).toBe(0)
  })
})

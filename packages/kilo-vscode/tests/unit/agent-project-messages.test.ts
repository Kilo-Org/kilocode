import { afterEach, beforeEach, describe, it, expect } from "bun:test"
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
const directories: string[] = []
let environment: NodeJS.ProcessEnv

beforeEach(() => {
  environment = { ...process.env }
  const config = path.join(directory(), "gitconfig")
  fs.writeFileSync(
    config,
    "[user]\nname = Test\nemail = test@example.com\n[commit]\ngpgsign = false\n[init]\ntemplateDir =\n",
  )
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  process.env.GIT_AUTHOR_NAME = "Test"
  process.env.GIT_AUTHOR_EMAIL = "test@example.com"
  process.env.GIT_COMMITTER_NAME = "Test"
  process.env.GIT_COMMITTER_EMAIL = "test@example.com"
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key]
  }
  Object.assign(process.env, environment)
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function directory() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-am-msg-")))
  directories.push(dir)
  return dir
}

function gitRepo(): string {
  const dir = directory()
  execFileSync("git", ["-c", "init.templateDir=", "init", "-q", dir])
  execFileSync("git", ["commit", "--allow-empty", "-qm", "Initial commit"], { cwd: dir })
  return dir
}

function setup(opts: { enabled?: boolean; workspace?: string; git?: GitOps; trusted?: boolean } = {}) {
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
    workspaceRoot: () => opts.workspace ?? WORKSPACE,
    registry,
    enabled: () => opts.enabled ?? true,
    deps: { log: () => {}, exists: (dir) => fs.existsSync(dir) },
  })
  const calls = {
    activate: [] as string[],
    expand: [] as string[],
    push: 0,
    error: [] as string[],
    pick: 0,
    ready: [] as string[],
    selected: [] as string[],
    confirm: [] as string[],
    notifications: [] as string[],
    inputs: [] as string[],
    answers: [] as boolean[],
    clone: [] as string[][],
    folders: [] as Parameters<ProjectMessageDeps["pickFolder"]>[0][],
    posts: [] as Array<{ type: string; parent?: string }>,
    readyResult: { ok: true, refsFixed: 0, current: true } as { ok: boolean; refsFixed: number; current: boolean },
  }
  const deps: ProjectMessageDeps = {
    registry,
    contexts,
    enabled: () => opts.enabled ?? true,
    pickFolder: async (input) => {
      calls.pick++
      calls.folders.push(input)
      return pickResult
    },
    onboarding: {
      input: async () => calls.inputs.shift(),
      confirm: async (message) => {
        calls.confirm.push(message)
        return calls.answers.shift() ?? false
      },
      cloneRepository: async (url, parent) => {
        calls.clone.push([url, parent])
        return pickResult
      },
      isTrusted: () => opts.trusted ?? true,
      notify: (_kind, message) => calls.notifications.push(message),
    },
    activate: (ctx) => calls.activate.push(ctx.id),
    expand: (ctx) => calls.expand.push(ctx.id),
    push: () => calls.push++,
    error: (message) => calls.error.push(message),
    selected: (target) => calls.selected.push(target.projectId),
    post: (message) => calls.posts.push(message as { type: string; parent?: string }),
    openSettings: () => {},
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

  it("rejects every mutation while the experiment is disabled", async () => {
    const { deps, calls } = setup({ enabled: false })
    for (const m of [
      msg("agentManager.addProject"),
      msg("agentManager.createProject"),
      msg("agentManager.cloneProject"),
      msg("agentManager.removeProject", { projectId: "prj-x" }),
      msg("agentManager.selectProject", { projectId: "prj-x" }),
      msg("agentManager.setProjectExpanded", { projectId: "prj-x", expanded: true }),
    ]) {
      await handleProjectMessage(m, deps)
    }
    expect(calls.pick).toBe(0)
    expect(calls.activate).toEqual([])
    expect(calls.error.length).toBe(6)
  })

  it("adds a picked git repository to the registry", async () => {
    const repo = gitRepo()
    const { deps, registry, calls, pick } = setup()
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    const id = projectIdFor(repo)
    const project = registry.get(id)
    expect(project?.root).toBe(repo)
    expect(calls.push).toBe(2)
    expect(calls.selected).toEqual([id])
    expect(project?.expanded).toBe(true)
    expect(calls.error).toEqual([])
  })

  it("does not initialize a non-git folder without confirmation", async () => {
    const dir = directory()
    const { deps, calls, registry, pick } = setup()
    pick(dir)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(registry.list()).toEqual([])
    expect(calls.confirm.at(0)).toContain("Initialize Git")
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(false)
    expect(calls.error).toEqual([])
  })

  it("uses the configured Git executable when adding a project", async () => {
    const repo = gitRepo()
    const git = new GitOps({ log: () => {}, binary: path.join(repo, "missing-git") })
    const { deps, calls, registry, pick } = setup({ git })
    pick(repo)

    await handleProjectMessage(msg("agentManager.addProject"), deps)
    git.dispose()

    expect(registry.list()).toEqual([])
    expect(calls.error.length).toBe(1)
    expect(calls.confirm).toEqual([])
  })

  it("selects the pinned workspace repository without duplicating it", async () => {
    const repo = gitRepo()
    const { deps, calls, pick } = setup({ workspace: repo })
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(calls.error).toEqual([])
    expect(calls.selected).toEqual([projectIdFor(repo)])
  })

  it("selects an existing registration without duplicating it", async () => {
    const repo = gitRepo()
    const { deps, calls, pick } = setup()
    pick(repo)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(calls.error).toEqual([])
    expect(calls.selected).toEqual([projectIdFor(repo), projectIdFor(repo)])
  })

  it("does nothing when the picker is cancelled", async () => {
    const { deps, calls, registry, pick } = setup()
    pick(undefined)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(registry.list()).toEqual([])
    expect(calls.push).toBe(0)
  })

  it("creates and selects a sibling project from an explicit parent and name", async () => {
    const workspace = gitRepo()
    const parent = directory()
    const { deps, calls, registry, contexts } = setup({ workspace })
    await handleProjectMessage(msg("agentManager.createProject", { parent, name: "new-project" }), deps)
    const root = path.join(parent, "new-project")
    expect(calls.error).toEqual([])
    expect(calls.pick).toBe(0)
    expect(calls.folders).toEqual([])
    expect(registry.list().map((entry) => entry.root)).toEqual([root])
    expect(contexts.pinned()?.root).toBe(workspace)
    expect(contexts.active()?.root).toBe(root)
    expect(calls.selected).toEqual([projectIdFor(root)])
    expect(execFileSync("git", ["ls-tree", "HEAD"], { cwd: root, encoding: "utf8" })).toBe("")
    expect(execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" })).toBe("")
  })

  it("opens an existing repository at the destination instead of duplicating it", async () => {
    const workspace = gitRepo()
    const parent = directory()
    const root = path.join(parent, "existing")
    fs.mkdirSync(root)
    execFileSync("git", ["-c", "init.templateDir=", "init", "-q", root])
    execFileSync("git", ["commit", "--allow-empty", "-qm", "Initial commit"], { cwd: root })
    const { deps, calls, registry, contexts } = setup({ workspace })
    await handleProjectMessage(msg("agentManager.createProject", { parent, name: "existing" }), deps)
    expect(calls.confirm).toEqual([])
    expect(calls.error).toEqual([])
    expect(registry.list().map((entry) => entry.root)).toEqual([root])
    expect(contexts.active()?.root).toBe(root)
    calls.notifications.length = 0
    await handleProjectMessage(msg("agentManager.createProject", { parent, name: "existing" }), deps)
    expect(registry.list()).toHaveLength(1)
    expect(calls.notifications.some((note) => note.includes("existing project"))).toBe(true)
  })

  it("opens a registered checkout instead of cloning the same repository", async () => {
    const workspace = gitRepo()
    const parent = directory()
    const root = path.join(parent, "repo")
    fs.mkdirSync(root)
    execFileSync("git", ["-c", "init.templateDir=", "init", "-q", root])
    execFileSync("git", ["commit", "--allow-empty", "-qm", "Initial commit"], { cwd: root })
    const { deps, calls, pick, registry, contexts } = setup({ workspace })
    pick(root)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    calls.clone.length = 0
    await handleProjectMessage(msg("agentManager.cloneProject", { url: "git@company:team/repo.git", parent }), deps)
    expect(calls.clone).toEqual([])
    expect(calls.error).toEqual([])
    expect(registry.list()).toHaveLength(1)
    expect(contexts.active()?.root).toBe(root)
  })

  it("posts the primary checkout parent for a new project", async () => {
    const workspace = gitRepo()
    const { deps, calls } = setup({ workspace })
    await handleProjectMessage(msg("agentManager.requestProjectParent"), deps)
    expect(calls.posts).toEqual([{ type: "agentManager.projectParent", parent: path.dirname(workspace) }])
  })

  it("posts the picked parent and stays silent on cancel", async () => {
    const picked = directory()
    const { deps, calls, pick } = setup()
    pick(picked)
    await handleProjectMessage(msg("agentManager.pickProjectParent", { defaultPath: "/somewhere" }), deps)
    expect(calls.folders.at(0)?.defaultPath).toBe("/somewhere")
    expect(calls.posts).toEqual([{ type: "agentManager.projectParent", parent: picked }])
    pick(undefined)
    await handleProjectMessage(msg("agentManager.pickProjectParent"), deps)
    expect(calls.posts.at(1)).toEqual({ type: "agentManager.projectParent", parent: undefined })
  })

  it("clones through the host and attaches its returned path outside the workspace", async () => {
    const workspace = gitRepo()
    const checkout = gitRepo()
    const { deps, calls, pick, contexts } = setup({ workspace })
    pick(checkout)
    await handleProjectMessage(
      msg("agentManager.cloneProject", { url: "git@company:team/project.git", parent: checkout }),
      deps,
    )
    expect(calls.clone).toEqual([["git@company:team/project.git", checkout]])
    expect(calls.pick).toBe(0)
    expect(contexts.pinned()?.root).toBe(workspace)
    expect(contexts.active()?.root).toBe(checkout)
    expect(calls.error).toEqual([])
  })

  it("initializes an existing folder only after confirmation and keeps files untracked", async () => {
    const root = directory()
    fs.writeFileSync(path.join(root, "secret.env"), "keep outside Git")
    const { deps, calls, pick, registry } = setup()
    pick(root)
    calls.answers.push(true)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    expect(calls.error).toEqual([])
    expect(registry.get(projectIdFor(root))?.root).toBe(root)
    expect(execFileSync("git", ["ls-tree", "HEAD"], { cwd: root, encoding: "utf8" })).toBe("")
    expect(fs.readFileSync(path.join(root, "secret.env"), "utf8")).toBe("keep outside Git")
  })

  it("blocks create and clone before opening dialogs in an untrusted window", async () => {
    const { deps, calls } = setup({ trusted: false })
    await handleProjectMessage(msg("agentManager.createProject"), deps)
    await handleProjectMessage(msg("agentManager.cloneProject"), deps)
    expect(calls.pick).toBe(0)
    expect(calls.clone).toEqual([])
    expect(calls.error).toHaveLength(2)
  })

  it("ignores duplicate clicks while a native onboarding flow is open", async () => {
    const { deps, calls } = setup()
    const gate = Promise.withResolvers<string | undefined>()
    deps.pickFolder = () => {
      calls.pick++
      return gate.promise
    }
    const first = handleProjectMessage(msg("agentManager.addProject"), deps)
    await handleProjectMessage(msg("agentManager.addProject"), deps)
    gate.resolve(undefined)
    await first
    expect(calls.pick).toBe(1)
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

  it("removes projects without touching the pinned fallback", async () => {
    const repo = gitRepo()
    const { deps, registry, contexts, calls } = setup()
    const id = projectIdFor(repo)
    await registry.add({ id, root: repo })
    await handleProjectMessage(msg("agentManager.selectProject", { projectId: id }), deps)
    await handleProjectMessage(msg("agentManager.removeProject", { projectId: id }), deps)
    expect(registry.get(id)).toBeUndefined()
    expect(contexts.get(id)).toBeUndefined()
    expect(contexts.active()?.root).toBe(WORKSPACE)
    expect(calls.activate).toEqual([id])
  })
})

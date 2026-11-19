import { afterEach, describe, expect, it, mock } from "bun:test"
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { OpenCodeClient } from "@opencode/client"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import { VscodeHost } from "../src/agent-manager/vscode-host"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host, PanelContext } from "../src/agent-manager/host"
import { canonicalizePath, projectIdFor } from "../src/agent-manager/project/paths"
import type { ProjectContext } from "../src/agent-manager/project/context"

const temp: string[] = []

afterEach(async () => {
  // Bun ignores the Node `maxRetries` option, and a git command the test started can still hold the temp repository on
  // Windows, so retry the removal here.
  for (const dir of temp.splice(0)) {
    for (let attempt = 1; ; attempt++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 15) throw error
        await Bun.sleep(150)
      }
    }
  }
})

function repo(name: string, branch: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kilo-sidebar-${name}-`))
  temp.push(root)
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: root })
  fs.mkdirSync(path.join(root, "component"))
  fs.writeFileSync(path.join(root, "component", "marker"), name)
  execFileSync("git", ["add", "component/marker"], { cwd: root })
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], {
    cwd: root,
  })
  return root
}

function panel(): PanelContext {
  return {
    active: true,
    visible: true,
    postMessage: () => undefined,
    waitForReady: async () => undefined,
    waitForActive: async () => undefined,
    reveal: () => undefined,
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }
}

function providerFor(workspace: string, projects: string[]) {
  const client = {
    project: { list: async () => [] },
    config: { get: mock(async () => ({})) },
    agent: { list: mock(async () => []) },
    mcp: { list: mock(async () => []) },
    session: { create: mock(async () => ({ id: "ses" })), prompt: mock(async () => undefined) },
  } as unknown as OpenCodeClient
  const connection = {
    client: async () => client,
    current: () => client,
    state: () => "connected",
    onState: () => () => undefined,
    onEvent: () => () => undefined,
    server: () => undefined,
    view: () => undefined,
    started: () => undefined,
    stopped: () => undefined,
    dispose: () => undefined,
  } as unknown as AgentManagerConnection
  const hostBase = {
    createOutput: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
    readProjects: () => ({
      version: 1,
      projects: projects.map((root, order) => ({
        id: projectIdFor(canonicalizePath(root)),
        root: canonicalizePath(root),
        order,
        addedAt: new Date().toISOString(),
      })),
    }),
    writeProjects: async () => undefined,
    workspacePath: () => workspace,
    worktreePool: () => false,
    autoBranchNaming: () => ({ enabled: false, prefix: "" }),
    extensionKeybindings: () => [],
    onDidChangeKeybindings: () => ({ dispose: () => undefined }),
    dirtyFiles: () => [],
    isTrusted: () => true,
    openDocument: async () => undefined,
    showError: () => undefined,
    showWorktreeCallerError: VscodeHost.prototype.showWorktreeCallerError,
    notify: () => undefined,
    openFile: () => undefined,
    refreshGit: () => undefined,
    dispose: () => undefined,
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  }
  const host = new Proxy(hostBase, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target]
      return () => ({ dispose: () => undefined })
    },
  }) as unknown as Host
  const panelHost = { open: () => panel(), restore: () => panel() } as never
  return new AgentManagerProvider(host, connection, panelHost)
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
}

function inventory(root: string) {
  return [git(root, "worktree", "list", "--porcelain"), git(root, "branch", "--list")]
}

async function delegate(provider: AgentManagerProvider, directory: string, branchName: string) {
  const errors: string[] = []
  provider.host.showError = (message) => errors.push(message)
  await provider.onToolEvent({
    id: branchName,
    created: Date.now(),
    type: "rpc.kilocode.agent-manager.start",
    location: { directory },
    data: { mode: "worktree", requestID: branchName, tasks: [{ branchName }] },
  })
  return errors
}

describe("tool worktree project routing", () => {
  it("creates tool worktrees only in the caller's managed project", async () => {
    const a = repo("selected", "main")
    const b = repo("caller", "main")
    const provider = providerFor(a, [b])
    provider.openPanel = () => undefined
    provider.pushState = () => undefined
    const before = inventory(a)
    const create = async (directory: string, branch: string) => {
      expect(await delegate(provider, directory, branch)).toEqual([])
      expect(inventory(a)).toEqual(before)
      const component = path.join(b, ".kilo", "worktrees", branch, "component")
      expect(fs.readFileSync(path.join(component, "marker"), "utf8")).toBe("caller")
      return component
    }
    try {
      expect(provider.contexts.active()?.root).toBe(canonicalizePath(a))
      const linked = await create(path.join(b, "component"), "subfolder")
      await create(b, "exact-root")
      provider.contexts.activate(projectIdFor(canonicalizePath(b)))
      provider.panel = {
        ...panel(),
        waitForReady: async () => {
          provider.contexts.activate(projectIdFor(canonicalizePath(a)))
        },
      }
      await create(linked, "from-linked")

      // Lexical containment is not ownership: this is another Git checkout inside B.
      const nested = path.join(b, "unregistered")
      git(b, "init", "-q", nested)
      const after = inventory(b)
      provider.panel = undefined
      for (const dir of [nested, path.join(b, "missing")]) {
        const errors = await delegate(provider, dir, "unknown")
        expect(errors).toHaveLength(1)
        expect(errors[0]).toContain(dir)
        expect(errors[0]).toContain("add it as a project in Agent Manager")
      }
      expect(inventory(b)).toEqual(after)
      expect(inventory(a)).toEqual(before)
    } finally {
      await provider.dispose()
    }
  }, 30_000)

  it("distinguishes the pinned linked checkout from its registered primary and rejects an ambiguous sibling", async () => {
    const root = repo("ambiguous", "main")
    const linked = path.join(root, "linked")
    git(root, "worktree", "add", "-q", "-b", "linked", linked)
    const sibling = path.join(root, "sibling")
    git(root, "worktree", "add", "-q", "-b", "sibling", sibling)
    const provider = providerFor(linked, [root])
    provider.openPanel = () => undefined
    provider.pushState = () => undefined
    try {
      expect(await delegate(provider, linked, "from-pinned")).toEqual([])
      expect(fs.existsSync(path.join(linked, ".kilo", "worktrees", "from-pinned", "component", "marker"))).toBe(true)
      expect(await delegate(provider, path.join(root, "component"), "from-primary")).toEqual([])
      expect(fs.existsSync(path.join(root, ".kilo", "worktrees", "from-primary", "component", "marker"))).toBe(true)
      const managed = path.join(linked, ".kilo", "worktrees", "from-pinned", "component")
      expect(await delegate(provider, managed, "from-managed")).toEqual([])
      expect(fs.existsSync(path.join(linked, ".kilo", "worktrees", "from-managed", "component", "marker"))).toBe(true)
      const before = inventory(root)
      expect(await delegate(provider, sibling, "ambiguous")).toEqual([expect.stringContaining(sibling)])
      expect(inventory(root)).toEqual(before)
    } finally {
      await provider.dispose()
    }
  }, 30_000)
})

describe("sidebar worktree project routing", () => {
  it("reads the branch of the workspace project instead of the active Agent Manager project", async () => {
    const sidebar = repo("sidebar", "sidebar")
    const other = repo("other", "other")
    const provider = providerFor(sidebar, [other])
    try {
      provider.contexts.activate(projectIdFor(canonicalizePath(other)))
      expect(provider.contexts.active()?.root).toBe(canonicalizePath(other))

      expect(await provider.workspaceBranch()).toBe("sidebar")
    } finally {
      await provider.dispose()
    }
  })

  it("shows the workspace project and runs continueInWorktree in its scope", async () => {
    const sidebar = repo("sidebar", "sidebar")
    const other = repo("other", "other")
    const provider = providerFor(sidebar, [other])
    try {
      provider.contexts.activate(projectIdFor(canonicalizePath(other)))
      const scopes: string[] = []
      provider.projectScope.run = ((ctx: ProjectContext) => {
        scopes.push(ctx.root)
        return Promise.resolve(undefined)
      }) as never

      await provider.continueFromSidebar("ses_sidebar", () => undefined)

      expect(provider.contexts.active()?.root).toBe(canonicalizePath(sidebar))
      expect(scopes).toEqual([canonicalizePath(sidebar)])
    } finally {
      await provider.dispose()
    }
  })

  it("continues an Agent Manager session in the project the panel shows and reports progress", async () => {
    const sidebar = repo("sidebar", "sidebar")
    const other = repo("other", "other")
    const provider = providerFor(sidebar, [other])
    try {
      provider.contexts.activate(projectIdFor(canonicalizePath(other)))
      const posts: unknown[] = []
      let rooted: string | undefined
      provider.postToWebview = (message) => posts.push(message)
      provider.continueInWorktree = async (_sessionId, progress) => {
        rooted = provider.context?.root
        progress("capturing")
        progress("done")
      }

      await provider.handlePanelMessage({ type: "agentManager.continueInWorktree", sessionId: "ses_panel" })

      expect(rooted).toBe(canonicalizePath(other))
      expect(provider.contexts.active()?.root).toBe(canonicalizePath(other))
      expect(posts).toEqual([
        { type: "continueInWorktreeProgress", status: "capturing", detail: undefined, error: undefined },
        { type: "continueInWorktreeProgress", status: "done", detail: undefined, error: undefined },
      ])
    } finally {
      await provider.dispose()
    }
  })
})

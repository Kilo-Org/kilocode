import { afterEach, describe, expect, it, mock } from "bun:test"
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { OpenCodeClient } from "@opencode/client"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host, PanelContext } from "../src/agent-manager/host"
import { canonicalizePath, projectIdFor } from "../src/agent-manager/project/paths"
import type { ProjectContext } from "../src/agent-manager/project/context"

const temp: string[] = []

afterEach(() => {
  // Git and the Windows indexer can hold a temp directory for a moment after the test; the other suites retry for the
  // same reason.
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

function repo(name: string, branch: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kilo-sidebar-${name}-`))
  temp.push(root)
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: root })
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], {
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
    autoBranchNaming: () => ({ enabled: false, prefix: "" }),
    extensionKeybindings: () => [],
    onDidChangeKeybindings: () => ({ dispose: () => undefined }),
    dirtyFiles: () => [],
    isTrusted: () => true,
    openDocument: async () => undefined,
    showError: () => undefined,
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

import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import type { Session } from "@kilocode/sdk/v2/client"
import { ProjectRouteService } from "../../src/agent-manager/project/route"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  contextSessionID?: string
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  handleEditorOpenMessage: (
    message:
      | { type: "openFile"; sessionID?: string; filePath: string; line?: number; column?: number }
      | { type: "validateFiles"; sessionID?: string; id: string; paths: string[] },
  ) => boolean
}

function session(directory: string): Session {
  return {
    id: "ses_frontend",
    slug: "frontend",
    projectID: "prj_frontend",
    directory,
    title: "Frontend",
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

function create(root: string, routes?: ProjectRouteService) {
  const provider = new KiloProvider({} as never, {} as never, undefined, {
    rootDirectory: () => root,
    routeService: routes,
  })
  const internal = provider as unknown as Internals
  internal.webview = { postMessage: async () => true }
  return { provider, internal }
}

const stat = spyOn(vscode.workspace.fs, "stat")
const roots = new Set<string>()

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-file-links-"))
  const frontend = path.join(root, "frontend")
  const backend = path.join(root, "backend")
  const worktree = path.join(frontend, ".kilo", "worktrees", "feature")
  await Promise.all([fs.mkdir(backend, { recursive: true }), fs.mkdir(worktree, { recursive: true })])
  roots.add(root)
  return { root, frontend, backend, worktree }
}

beforeEach(() => {
  stat.mockClear()
  stat.mockImplementation(async () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }))
})

afterAll(async () => {
  await Promise.all([...roots].map((root) => fs.rm(root, { recursive: true, force: true })))
  stat.mockRestore()
})

describe("KiloProvider chat file links", () => {
  it("validates a relative link from the session directory instead of the workspace parent", async () => {
    const { root, frontend: dir } = await fixture()
    const file = path.join(dir, "spec", "foo_spec.rb")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "describe 'example'\n")

    const state = create(root)
    const result = new Promise<unknown>((resolve) => {
      state.internal.webview = {
        postMessage: async (message) => {
          if ((message as { type?: unknown }).type === "validateFilesResult") resolve(message)
          return true
        },
      }
    })
    state.provider.registerSession(session(dir))

    state.internal.handleEditorOpenMessage({
      type: "validateFiles",
      sessionID: "ses_frontend",
      id: "check",
      paths: ["spec/foo_spec.rb"],
    })

    expect(await result).toEqual({
      type: "validateFilesResult",
      id: "check",
      existing: ["spec/foo_spec.rb"],
    })
    stat.mockClear()

    state.internal.handleEditorOpenMessage({
      type: "openFile",
      sessionID: "ses_frontend",
      filePath: "spec/foo_spec.rb",
    })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: file }))
  })

  it("resolves a relative link from the active session directory in a multi-repo workspace", async () => {
    const { root, frontend } = await fixture()
    const state = create(root)
    state.provider.registerSession(session(frontend))

    state.internal.handleEditorOpenMessage({
      type: "openFile",
      sessionID: "ses_frontend",
      filePath: "spec/foo_spec.rb",
      line: 12,
    })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(frontend, "spec", "foo_spec.rb") }))
  })

  it("falls back to the workspace when the session directory no longer exists", async () => {
    const { root } = await fixture()
    const file = path.join(root, "spec", "foo_spec.rb")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "describe 'example'\n")

    const state = create(root)
    const result = new Promise<unknown>((resolve) => {
      state.internal.webview = {
        postMessage: async (message) => {
          if ((message as { type?: unknown }).type === "validateFilesResult") resolve(message)
          return true
        },
      }
    })
    state.provider.registerSession(session(path.join(root, "removed")))

    state.internal.handleEditorOpenMessage({ type: "validateFiles", id: "check", paths: ["spec/foo_spec.rb"] })

    expect(await result).toEqual({
      type: "validateFilesResult",
      id: "check",
      existing: ["spec/foo_spec.rb"],
    })
    stat.mockClear()

    state.internal.handleEditorOpenMessage({ type: "openFile", filePath: "spec/foo_spec.rb" })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: file }))
  })

  it("does not use the previous session directory while switching sessions", async () => {
    const { root, backend } = await fixture()
    const state = create(root)
    state.provider.registerSession({
      ...session(backend),
      id: "ses_backend",
      slug: "backend",
      projectID: "prj_backend",
      title: "Backend",
    })
    state.internal.contextSessionID = "ses_frontend"

    state.internal.handleEditorOpenMessage({ type: "openFile", filePath: "spec/foo_spec.rb", line: 12 })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(root, "spec", "foo_spec.rb") }))
  })

  it("uses the displayed session while the extension focus is stale offline", async () => {
    const { root, frontend, backend } = await fixture()
    const state = create(root)
    state.provider.registerSession({
      ...session(backend),
      id: "ses_backend",
      slug: "backend",
      projectID: "prj_backend",
      title: "Backend",
    })
    state.provider.setSessionDirectory("ses_frontend", frontend)
    state.internal.contextSessionID = "ses_backend"

    state.internal.handleEditorOpenMessage({
      type: "openFile",
      sessionID: "ses_frontend",
      filePath: "spec/foo_spec.rb",
      line: 12,
    })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(frontend, "spec", "foo_spec.rb") }))
  })

  it("prefers an explicit directory override for the active session", async () => {
    const { root, frontend, worktree } = await fixture()
    const state = create(root)
    state.provider.registerSession(session(frontend))
    state.provider.setSessionDirectory("ses_frontend", worktree)

    state.internal.handleEditorOpenMessage({
      type: "openFile",
      sessionID: "ses_frontend",
      filePath: "spec/foo_spec.rb",
      line: 12,
    })

    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(worktree, "spec", "foo_spec.rb") }))
  })

  it("refuses file actions for an ambiguous session route", async () => {
    const { root, frontend, backend } = await fixture()
    const routes = new ProjectRouteService()
    routes.registerProject("frontend", frontend, 1)
    routes.registerProject("backend", backend, 1)
    routes.registerSession({ projectId: "frontend", sessionId: "same" }, frontend, 1)
    routes.registerSession({ projectId: "backend", sessionId: "same" }, backend, 1)
    const state = create(root, routes)
    const result = new Promise<unknown>((resolve) => {
      state.internal.webview = {
        postMessage: async (message) => {
          if ((message as { type?: unknown }).type === "validateFilesResult") resolve(message)
          return true
        },
      }
    })

    state.internal.handleEditorOpenMessage({
      type: "validateFiles",
      sessionID: "same",
      id: "check",
      paths: ["spec/foo_spec.rb"],
    })

    expect(await result).toEqual({ type: "validateFilesResult", id: "check", existing: [] })

    state.internal.handleEditorOpenMessage({ type: "openFile", sessionID: "same", filePath: "spec/foo_spec.rb" })

    expect(stat).not.toHaveBeenCalled()
  })
})

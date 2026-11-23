import { describe, expect, it, mock } from "bun:test"
import { AgentManagerProvider } from "../../src/agent-manager/AgentManagerProvider"

type Context = {
  id: string
  root: string
  lifecycle: "ready"
  peekState: () => {
    getSessions: () => unknown[]
    getWorktrees: () => unknown[]
    getWorktree: () => undefined
  }
}

function context(id: string, root: string): Context {
  return {
    id,
    root,
    lifecycle: "ready",
    peekState: () => ({ getSessions: () => [], getWorktrees: () => [], getWorktree: () => undefined }),
  }
}

type Manager = {
  contexts: { active: () => Context | undefined }
  projectScope: { current: () => undefined }
  panel:
    | {
        postMessage: (message: unknown) => void
        sessions: {
          setSessionDirectory: (id: string, directory: string) => void
          trackSession: (id: string) => void
          refreshSessions: () => void
          refreshGitStatus: () => void
          retryInitialization: () => void
        }
      }
    | undefined
  statsPoller: { stop: () => void }
  prBridge: { reset: () => void }
  busySessions: Set<string>
  projectPollers: { sync: () => void }
  sendRepoInfo: () => Promise<void>
  pushState: () => void
  activateProject: (ctx: Context) => void
  getRoot: () => string | undefined
}

function createManager(options?: { panel?: boolean; active?: Context }) {
  const messages: unknown[] = []
  const manager = Object.create(AgentManagerProvider.prototype) as Manager
  const active = options?.active
  manager.contexts = { active: () => active }
  manager.projectScope = { current: () => undefined }
  manager.panel =
    options?.panel === false
      ? undefined
      : {
          postMessage: (message) => messages.push(message),
          sessions: {
            setSessionDirectory: () => undefined,
            trackSession: () => undefined,
            refreshSessions: () => undefined,
            refreshGitStatus: () => undefined,
            retryInitialization: () => undefined,
          },
        }
  manager.statsPoller = { stop: () => undefined }
  manager.prBridge = { reset: () => undefined }
  manager.busySessions = new Set()
  manager.projectPollers = { sync: () => undefined }
  manager.sendRepoInfo = mock(async () => undefined)
  manager.pushState = mock(() => undefined)
  return { manager, messages }
}

describe("AgentManagerProvider project activation directory", () => {
  it("tells the panel the new project's root after switching projects", () => {
    // Mention search in the panel's prompt resolves against the directory the
    // panel was last told about, so switching projects must announce the root
    // that is effective now rather than leaving the previous one in place.
    const next = context("prj-b", "/repo/project-b")
    const { manager, messages } = createManager({ active: next })

    manager.activateProject(next)

    expect(messages).toEqual([{ type: "workspaceDirectoryChanged", directory: "/repo/project-b" }])
  })

  it("posts nothing when the activation runs without a panel", () => {
    const next = context("prj-b", "/repo/project-b")
    const { manager, messages } = createManager({ panel: false, active: next })

    manager.activateProject(next)

    expect(messages).toEqual([])
  })
})

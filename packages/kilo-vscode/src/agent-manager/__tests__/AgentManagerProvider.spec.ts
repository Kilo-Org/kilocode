import { describe, it, expect, vi } from "vitest"

vi.mock("../WorktreeManager", () => ({
  WorktreeManager: class {},
}))

vi.mock("../WorktreeStateManager", () => ({
  WorktreeStateManager: class {},
}))

vi.mock("../GitStatsPoller", () => ({
  GitStatsPoller: class {
    setEnabled() {}
    stop() {}
  },
}))

vi.mock("../GitOps", () => ({
  GitOps: class {},
}))

vi.mock("../SetupScriptService", () => ({
  SetupScriptService: class {
    hasScript() {
      return false
    }
  },
}))

vi.mock("../SetupScriptRunner", () => ({
  SetupScriptRunner: class {
    async runIfConfigured() {
      return false
    }
  },
}))

vi.mock("../SessionTerminalManager", () => ({
  SessionTerminalManager: class {
    showTerminal() {}
    showLocalTerminal() {}
    syncLocalOnSessionSwitch() {}
    syncOnSessionSwitch() {
      return false
    }
    dispose() {}
  },
}))

vi.mock("../terminal-host", () => ({
  createTerminalHost: () => ({}),
}))

vi.mock("../format-keybinding", () => ({
  formatKeybinding: (value: string) => value,
}))

vi.mock("../branch-name", () => ({
  versionedName: () => ({ branch: "branch", label: "label" }),
}))

vi.mock("../git-import", () => ({
  normalizePath: (value: string) => value,
}))

import { AgentManagerProvider } from "../AgentManagerProvider"
import type { Host, OutputHandle } from "../host"

function createMockHost(): Host {
  return {
    openPanel: vi.fn(),
    workspacePath: () => "/repo",
    showError: vi.fn(),
    openDocument: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn(),
    openFolder: vi.fn(),
    createOutput: () => ({ appendLine: vi.fn(), dispose: vi.fn() }) as OutputHandle,
    extensionKeybindings: () => [],
    serverPort: () => undefined,
    capture: vi.fn(),
    dispose: vi.fn(),
  }
}

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return {
    promise,
    resolve: () => resolve?.(),
  }
}

function createHarness() {
  const host = createMockHost()
  const manager = Object.create(AgentManagerProvider.prototype) as {
    host: Host
    panel: { sessions: { registerSession: ReturnType<typeof vi.fn> } } | undefined
    prBridge: { handleMessage: ReturnType<typeof vi.fn> }
    activeSessionId: string | undefined
    stateReady: Promise<void> | undefined
    createWorktreeOnDisk: ReturnType<typeof vi.fn>
    runSetupScriptForWorktree: ReturnType<typeof vi.fn>
    createSessionInWorktree: ReturnType<typeof vi.fn>
    getStateManager: ReturnType<typeof vi.fn>
    registerWorktreeSession: ReturnType<typeof vi.fn>
    notifyWorktreeReady: ReturnType<typeof vi.fn>
    log: ReturnType<typeof vi.fn>
    onCreateWorktree: () => Promise<null>
    onMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  }

  manager.host = host
  manager.panel = {
    sessions: {
      registerSession: vi.fn(),
    },
  }
  manager.prBridge = { handleMessage: vi.fn().mockReturnValue(false) }
  manager.activeSessionId = undefined
  manager.stateReady = Promise.resolve()
  manager.createWorktreeOnDisk = vi.fn()
  manager.runSetupScriptForWorktree = vi.fn().mockResolvedValue(undefined)
  manager.createSessionInWorktree = vi.fn()
  manager.getStateManager = vi.fn().mockReturnValue({ addSession: vi.fn() })
  manager.registerWorktreeSession = vi.fn()
  manager.notifyWorktreeReady = vi.fn()
  manager.log = vi.fn()

  return manager
}

describe("AgentManagerProvider worktree creation", () => {
  it("registers the first worktree session with session provider", async () => {
    const manager = createHarness()
    const created = {
      worktree: { id: "wt-1" },
      result: { path: "/repo/.kilo/worktrees/wt-1", branch: "feature/wt-1", parentBranch: "main" },
    }
    const session = { id: "session-1" }
    const state = { addSession: vi.fn() }

    manager.createWorktreeOnDisk.mockResolvedValue(created)
    manager.createSessionInWorktree.mockResolvedValue(session)
    manager.getStateManager.mockReturnValue(state)

    await manager.onCreateWorktree()

    expect(state.addSession).toHaveBeenCalledWith("session-1", "wt-1")
    expect(manager.panel!.sessions.registerSession).toHaveBeenCalledWith(session)
  })

  it("waits for state initialization before creating a worktree", async () => {
    const manager = createHarness()
    const ready = deferred()

    manager.stateReady = ready.promise
    manager.createWorktreeOnDisk.mockResolvedValue({
      worktree: { id: "wt-2" },
      result: { path: "/repo/.kilo/worktrees/wt-2", branch: "feature/wt-2", parentBranch: "main" },
    })
    manager.createSessionInWorktree.mockResolvedValue({ id: "session-2" })
    manager.getStateManager.mockReturnValue({ addSession: vi.fn() })

    const pending = manager.onCreateWorktree()
    await Promise.resolve()

    expect(manager.createWorktreeOnDisk).not.toHaveBeenCalled()

    ready.resolve()
    await pending

    expect(manager.createWorktreeOnDisk).toHaveBeenCalledTimes(1)
  })

  it("routes file search through the active worktree session", async () => {
    const manager = createHarness()
    manager.activeSessionId = "session-wt"

    const result = await manager.onMessage({ type: "requestFileSearch", query: "src", requestId: "r1" })

    expect(result).toEqual({ type: "requestFileSearch", query: "src", requestId: "r1", sessionID: "session-wt" })
  })
})

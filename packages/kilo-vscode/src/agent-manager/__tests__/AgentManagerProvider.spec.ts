import { describe, it, expect, vi } from "vitest"

vi.mock("vscode", () => ({
  window: {},
  workspace: {},
  ViewColumn: { One: 1 },
}))

vi.mock("../../services/telemetry", () => ({
  TelemetryProxy: {
    capture: vi.fn(),
  },
  TelemetryEventName: {
    AGENT_MANAGER_SESSION_STARTED: "agent-manager-session-started",
  },
}))

vi.mock("../../KiloProvider", () => ({
  KiloProvider: class {
    attachToWebview() {}
    setSessionDirectory() {}
    trackSession() {}
    refreshSessions() {}
    registerSession() {}
    clearSessionDirectory() {}
    dispose() {}
  },
}))

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
  const manager = Object.create(AgentManagerProvider.prototype) as {
    provider: { registerSession: ReturnType<typeof vi.fn> }
    stateReady: Promise<void> | undefined
    createWorktreeOnDisk: ReturnType<typeof vi.fn>
    runSetupScriptForWorktree: ReturnType<typeof vi.fn>
    createSessionInWorktree: ReturnType<typeof vi.fn>
    getStateManager: ReturnType<typeof vi.fn>
    registerWorktreeSession: ReturnType<typeof vi.fn>
    notifyWorktreeReady: ReturnType<typeof vi.fn>
    log: ReturnType<typeof vi.fn>
    onCreateWorktree: () => Promise<null>
  }

  manager.provider = {
    registerSession: vi.fn(),
  }
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
  it("registers the first worktree session with KiloProvider", async () => {
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
    expect(manager.provider.registerSession).toHaveBeenCalledWith(session)
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
})

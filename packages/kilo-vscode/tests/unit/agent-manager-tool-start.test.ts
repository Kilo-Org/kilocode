import { describe, expect, it, mock } from "bun:test"
import { parseToolRequest, startFromTool, type ToolDeps, type ToolRequest } from "../../src/agent-manager/tool-start"
import type { CreateWorktreeResult } from "../../src/agent-manager/WorktreeManager"
import type { Session } from "@kilocode/sdk/v2/client"

function session(id: string): Session {
  return { id, title: id, createdAt: "", updatedAt: "" } as Session
}

function result(path: string): CreateWorktreeResult {
  return { path, branch: "kilo/test", parentBranch: "main", startPointSource: "fallback" } as CreateWorktreeResult
}

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const calls: unknown[] = []
  const panel = {
    waitForReady: mock(async () => calls.push("waitForReady")),
    sessions: { registerSession: mock(() => calls.push("registerSession")) },
  }
  return {
    getClient: () =>
      ({
        session: {
          create: mock(async () => ({ data: session("s-local") })),
          promptAsync: mock(async () => ({})),
        },
      }) as never,
    getRoot: () => "/repo",
    getState: () => ({ addSession: mock(() => calls.push("addSession")) }) as never,
    getPanel: () => panel as never,
    openPanel: mock(() => calls.push("openPanel")),
    waitReady: mock(async () => calls.push("waitReady")),
    createWorktree: mock(async () => ({ worktree: { id: "wt-1" }, result: result("/repo/.kilo/worktrees/wt-1") })),
    cleanupWorktree: mock(async () => calls.push("cleanupWorktree")),
    setup: mock(async () => calls.push("setup")),
    createSessionInWorktree: mock(async () => session("s-wt")),
    registerWorktreeSession: mock(() => calls.push("registerWorktreeSession")),
    notifyReady: mock(() => calls.push("notifyReady")),
    push: mock(() => calls.push("push")),
    post: mock((msg: unknown) => calls.push(msg)),
    capture: mock(() => calls.push("capture")),
    log: mock(() => {}),
    error: mock(() => {}),
    ...overrides,
  }
}

describe("agent manager tool start", () => {
  it("parses tool start events defensively", () => {
    const parsed = parseToolRequest({ mode: "local", tasks: [{ prompt: "one" }] })
    expect(parsed?.requestID.startsWith("am-")).toBe(true)
    expect(parsed?.sessionID).toBeUndefined()
    expect(parsed?.directory).toBeUndefined()
    expect(parsed?.mode).toBe("local")
    expect(parsed?.versions).toBeUndefined()
    expect(parsed?.tasks).toEqual([{ prompt: "one" }])
    expect(parseToolRequest({ mode: "bad", tasks: [{ prompt: "one" }] })).toBeUndefined()
    expect(parseToolRequest({ mode: "local", tasks: [] })).toBeUndefined()
    expect(parseToolRequest({ mode: "local", tasks: [{}] })).toBeUndefined()
  })

  it("starts local sessions and sends the initial prompt", async () => {
    const client = {
      session: {
        create: mock(async () => ({ data: session("s-local") })),
        promptAsync: mock(async () => ({})),
      },
    }
    const c = deps({ getClient: () => client as never })
    const req: ToolRequest = {
      requestID: "am-1",
      mode: "local",
      tasks: [{ prompt: "Do work" }],
    }

    await startFromTool(c, req)

    expect(c.openPanel).toHaveBeenCalledWith(true)
    const panel = c.getPanel()
    expect(panel?.waitForReady).toHaveBeenCalled()
    expect(client.session.create).toHaveBeenCalledWith(
      { directory: "/repo", platform: "agent-manager" },
      { throwOnError: true },
    )
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s-local",
        directory: "/repo",
        parts: [{ type: "text", text: "Do work" }],
      }),
      { throwOnError: true },
    )
  })

  it("starts worktree sessions through existing hooks", async () => {
    const c = deps()
    await startFromTool(c, { requestID: "am-2", mode: "worktree", tasks: [{ prompt: "Fix", branchName: "fix/one" }] })

    expect(c.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: "fix-one", name: "fix-one", label: "one" }),
    )
    expect(c.setup).toHaveBeenCalled()
    expect(c.createSessionInWorktree).toHaveBeenCalled()
    expect(c.registerWorktreeSession).toHaveBeenCalledWith("s-wt", "/repo/.kilo/worktrees/wt-1")
    expect(c.notifyReady).toHaveBeenCalled()
  })

  it("only applies version suffixes when versions is true", async () => {
    const normal = deps()
    await startFromTool(normal, {
      requestID: "am-normal",
      mode: "worktree",
      tasks: [
        { prompt: "Fix one", branchName: "fix/one" },
        { prompt: "Fix two", branchName: "fix/two" },
      ],
    })
    expect(normal.createWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchName: "fix-two", label: "two" }),
    )

    const grouped = deps()
    await startFromTool(grouped, {
      requestID: "am-versions",
      mode: "worktree",
      versions: true,
      tasks: [
        { prompt: "Try one", branchName: "try/work" },
        { prompt: "Try two", branchName: "try/work" },
      ],
    })
    expect(grouped.createWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchName: "try-work_v2", label: "try work v2" }),
    )
  })

  it("sanitizes branch names and keeps card labels short", async () => {
    const c = deps()
    await startFromTool(c, {
      requestID: "am-name",
      mode: "worktree",
      tasks: [
        {
          prompt: "Fix command permissions persistence regression",
          name: "Fix command permissions persistence regression that is too long",
          branchName: "fix command permissions @#$ persistence",
        },
      ],
    })

    expect(c.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        branchName: "fix-command-permissions-persistence",
        label: "command permissions",
      }),
    )
  })

  it("rejects local sessions for unknown worktree directories", async () => {
    const client = {
      session: {
        create: mock(async () => ({ data: session("s-local") })),
        promptAsync: mock(async () => ({})),
      },
    }
    const c = deps({
      getClient: () => client as never,
      getState: () => ({ addSession: mock(), findWorktreeByPath: mock(() => undefined) }) as never,
    })

    await startFromTool(c, {
      requestID: "am-dir",
      mode: "local",
      directory: "/repo/other",
      tasks: [{ prompt: "Do work" }],
    })

    expect(client.session.create).not.toHaveBeenCalled()
    expect(c.error).toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { AgentManagerRequest, Session } from "@kilocode/sdk/v2/client"
import { AgentManagerOrchestrationBridge } from "../../src/agent-manager/orchestration-bridge"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"

async function waitFor(check: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !check(); index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

describe("AgentManagerOrchestrationBridge", () => {
  let root: string
  let dir: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-bridge-"))
    dir = path.join(root, "worktree")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(dir)
    state = new WorktreeStateManager(root, () => undefined)
    const worktree = state.addWorktree({ branch: "fix/bridge", path: dir, parentBranch: "main" })
    state.addSession("ses_target", worktree.id)
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function harness() {
    const replies: unknown[] = []
    const rejections: unknown[] = []
    const lists = new Map<string, AgentManagerRequest[]>()
    const handlers: {
      event?: (event: SSEPayload, directory?: string) => void
      state?: (state: "connecting" | "connected" | "disconnected" | "error") => void
    } = {}
    const status = { failList: "", failReply: false }
    const managed = new Set(["ses_target"])
    const promptAsync = mock(async () => ({ data: undefined }))
    const close = mock(async () => undefined)
    const client = {
      session: {
        get: mock(async () => ({
          data: { id: "ses_target", directory: dir, title: "Target" } as Session,
        })),
        status: mock(async () => ({ data: {} })),
        promptAsync,
      },
      kilocode: {
        agentManager: {
          list: mock(async ({ directory }: { directory?: string }) => {
            if (directory === status.failList) throw new Error("offline")
            return { data: lists.get(directory ?? "") ?? [] }
          }),
          reply: mock(async (input: unknown) => {
            replies.push(input)
            return status.failReply ? { error: "offline" } : { data: true }
          }),
          reject: mock(async (input: unknown) => {
            rejections.push(input)
            return { data: true }
          }),
        },
      },
    }
    const providers = new Set<() => string[]>()
    const connection = {
      onEvent: (listener: typeof handlers.event) => {
        handlers.event = listener
        return () => {
          handlers.event = undefined
        }
      },
      onStateChange: (listener: typeof handlers.state) => {
        handlers.state = listener
        return () => {
          handlers.state = undefined
        }
      },
      registerDirectoryProvider: (provider: () => string[]) => {
        providers.add(provider)
        return () => providers.delete(provider)
      },
      getKnownDirectories: () => [...new Set([...providers].flatMap((provider) => provider()))],
      getClient: () => client,
    }
    const bridge = new AgentManagerOrchestrationBridge(connection as never, {
      root: () => root,
      ready: async () => state,
      state: () => state,
      stats: async () => ({ worktrees: [] }),
      prs: () => new Map(),
      managed: (id) => managed.has(id),
      close,
      log: () => undefined,
    })
    const request = (value: AgentManagerRequest, directory = root) =>
      handlers.event?.(
        { id: `event-${value.id}`, type: "kilocode.agent_manager.requested", properties: value } as SSEPayload,
        directory,
      )
    return { bridge, client, close, handlers, lists, managed, promptAsync, rejections, replies, request, status }
  }

  const request: AgentManagerRequest = {
    id: "amr_prompt",
    sessionID: "ses_caller",
    operation: "prompt",
    targetSessionID: "ses_target",
    prompt: "Continue",
  }

  it("deduplicates prompt delivery and retries only the failed acknowledgement", async () => {
    const test = harness()
    test.status.failReply = true

    test.request(request)
    await waitFor(() => test.replies.length === 1)
    test.status.failReply = false
    test.request(request)
    await waitFor(() => test.replies.length === 2)

    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses_target",
        directory: dir,
        messageID: "msg_agent_manager_amr_prompt",
        parts: [{ type: "text", text: "Continue" }],
      }),
      { throwOnError: true },
    )
    expect(test.replies).toEqual([
      {
        requestID: "amr_prompt",
        directory: root,
        result: { operation: "prompt", sessionID: "ses_target", delivered: true },
      },
      {
        requestID: "amr_prompt",
        directory: root,
        result: { operation: "prompt", sessionID: "ses_target", delivered: true },
      },
    ])
    test.bridge.dispose()
  })

  it("stops a managed session through the same close operation as the UI", async () => {
    const test = harness()
    test.status.failReply = true
    const stop: AgentManagerRequest = {
      id: "amr_stop",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_target",
    }

    test.request(stop)
    await waitFor(() => test.replies.length === 1)
    test.status.failReply = false
    test.request(stop)
    await waitFor(() => test.replies.length === 2)

    expect(test.close).toHaveBeenCalledTimes(1)
    expect(test.close).toHaveBeenCalledWith("ses_target")
    expect(test.replies).toEqual([
      {
        requestID: "amr_stop",
        directory: root,
        result: { operation: "stop", sessionID: "ses_target", stopped: true },
      },
      {
        requestID: "amr_stop",
        directory: root,
        result: { operation: "stop", sessionID: "ses_target", stopped: true },
      },
    ])
    test.bridge.dispose()
  })

  it("stops a live panel session before it is persisted", async () => {
    const test = harness()
    test.managed.add("ses_live")

    test.request({
      id: "amr_stop_live",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_live",
    })
    await waitFor(() => test.replies.length === 1)

    expect(state.getSession("ses_live")).toBeUndefined()
    expect(test.close).toHaveBeenCalledWith("ses_live")
    expect(test.replies[0]).toEqual({
      requestID: "amr_stop_live",
      directory: root,
      result: { operation: "stop", sessionID: "ses_live", stopped: true },
    })
    test.bridge.dispose()
  })

  it("rejects stopping a session not managed by the current workspace", async () => {
    const test = harness()
    test.request({
      id: "amr_stop_unknown",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_unknown",
    })
    await waitFor(() => test.rejections.length === 1)

    expect(test.close).not.toHaveBeenCalled()
    expect(test.rejections).toEqual([
      {
        requestID: "amr_stop_unknown",
        directory: root,
        error: {
          code: "unknown_session",
          message: "The session is not managed by this Agent Manager workspace",
        },
      },
    ])
    test.bridge.dispose()
  })

  it("rejects request origins outside the current Agent Manager workspace", async () => {
    const test = harness()

    test.request(request, "/outside")
    await waitFor(() => test.rejections.length === 1)

    expect(test.promptAsync).not.toHaveBeenCalled()
    expect(test.rejections).toEqual([
      {
        requestID: "amr_prompt",
        directory: "/outside",
        error: {
          code: "cross_workspace",
          message: "Agent Manager request directory does not belong to this workspace",
        },
      },
    ])
    test.bridge.dispose()
  })

  it("accepts a canonical alias of the current workspace directory", async () => {
    const test = harness()

    test.request(request, fs.realpathSync(root))
    await waitFor(() => test.replies.length === 1)

    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.rejections).toEqual([])
    test.bridge.dispose()
  })

  it("recovers pending requests for the root and managed worktree directories", async () => {
    const test = harness()
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.promptAsync.mock.calls.length === 1)

    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: root })
    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: dir })
    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_prompt",
      directory: dir,
      result: { operation: "prompt", sessionID: "ses_target", delivered: true },
    })
    test.bridge.dispose()
  })

  it("continues recovery when another managed directory fails", async () => {
    const test = harness()
    test.status.failList = root
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.promptAsync.mock.calls.length === 1)

    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: root })
    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: dir })
    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    test.bridge.dispose()
  })
})

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
    const promptAsync = mock(async () => ({ data: undefined }))
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
      log: () => undefined,
    })
    const request = (value: AgentManagerRequest, directory = root) =>
      handlers.event?.(
        { id: `event-${value.id}`, type: "kilocode.agent_manager.requested", properties: value } as SSEPayload,
        directory,
      )
    return { bridge, client, handlers, lists, promptAsync, rejections, replies, request, status }
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
